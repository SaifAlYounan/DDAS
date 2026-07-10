/**
 * End-to-end over HTTP: the whole Phase-1 headless pipeline, now behind the
 * API — submit → extract (fake provider) → facts_review → confirm → classify
 * → route → approve → decide, plus replay, audit verify, and simulation.
 * The Kolvarra golden corpus is replayed case-by-case: HTTP parity with the
 * engine's own corpus suite.
 */
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import type { ExtractionProvider } from "@ddas/extraction";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";
import { newSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "./plugins/auth.js";

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/testkit/corpus/kolvarra"
);

interface CorpusCase {
  case_id: string;
  documents: Array<{ path: string; sha256: string }>;
  labeled_facts: Array<{
    id: string;
    status: "FOUND" | "NOT_FOUND";
    value?: unknown;
    unit?: string;
    citation?: { doc_index: number; text: string };
  }>;
  expected_routing: {
    expected: {
      status: "ROUTED" | "INCOMPLETE";
      tier?: number;
      binding_category?: string;
    };
    initiator_kind?: "human" | "agent";
  };
}

/** A provider that answers with the current case's labeled facts. */
function fakeProvider(): ExtractionProvider & { current: CorpusCase | null } {
  const provider = {
    id: "fake",
    model: "labeled-facts-v1",
    current: null as CorpusCase | null,
    async complete(): Promise<string> {
      const c = provider.current;
      if (!c) throw new Error("fake provider: no current case set");
      return JSON.stringify({
        facts: c.labeled_facts.map((f) =>
          f.status === "NOT_FOUND"
            ? { id: f.id, status: "NOT_FOUND" }
            : {
                id: f.id,
                status: "FOUND",
                value: f.value,
                ...(f.unit ? { unit: f.unit } : {}),
                confidence: 0.95,
                citation: { doc_index: f.citation!.doc_index, quote: f.citation!.text },
              }
        ),
      });
    },
  };
  return provider;
}

function multipart(
  fields: Record<string, string>,
  files: Array<{ filename: string; content: string }>
): { payload: string; headers: Record<string, string> } {
  const boundary = "----ddasE2EBoundary42";
  let payload = "";
  for (const [name, value] of Object.entries(fields)) {
    payload += `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  for (const file of files) {
    payload += `--${boundary}\r\ncontent-disposition: form-data; name="files"; filename="${file.filename}"\r\ncontent-type: text/plain\r\n\r\n${file.content}\r\n`;
  }
  payload += `--${boundary}--\r\n`;
  return {
    payload,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe.skipIf(!TEST_DATABASE_URL)("server e2e", () => {
  let app: App;
  let pool: pg.Pool;
  const provider = fakeProvider();
  const cookies: Record<string, string> = {};
  const principalIds: Record<string, string> = {};
  let rootUnitId: string;
  let policyVersionId: string;

  const kolvarraYaml = readFileSync(
    path.join(CORPUS_DIR, "policy/kolvarra-risk.v1.yaml"),
    "utf8"
  );

  function loadCase(id: string): CorpusCase {
    return JSON.parse(
      readFileSync(path.join(CORPUS_DIR, "cases", `${id}.json`), "utf8")
    ) as CorpusCase;
  }
  function caseDocs(c: CorpusCase): Array<{ filename: string; content: string }> {
    return c.documents.map((d) => ({
      filename: path.basename(d.path),
      content: readFileSync(path.join(CORPUS_DIR, d.path), "utf8"),
    }));
  }

  let agentToken = "";

  async function as(user: string, opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) {
    const auth: Record<string, string> =
      user === "agent" ? { authorization: `Bearer ${agentToken}` } : { cookie: cookies[user]! };
    const response = await app.inject({
      method: opts.method as "GET",
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as string } : {}),
      headers: { ...(opts.headers ?? {}), ...auth },
    });
    return response;
  }

  async function login(user: string, email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
    cookies[user] = cookie;
    return response.json() as { id: string };
  }

  async function pollState(user: string, requestId: string, want: string, timeoutMs = 30_000) {
    const startedAt = Date.now();
    for (;;) {
      const response = await as(user, { method: "GET", url: `/api/v1/requests/${requestId}` });
      const body = response.json() as { state: string; failureReason: string | null };
      if (body.state === want) return body;
      if (body.state === "failed") {
        throw new Error(`request failed: ${body.failureReason}`);
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`timeout waiting for ${want}, still ${body.state}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number) {
    const startedAt = Date.now();
    for (;;) {
      if (await check()) return;
      if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Submit a case end-to-end up to facts_review; returns request + fact set ids. */
  async function submitCase(c: CorpusCase, requesterKind: "human" | "agent") {
    provider.current = c;
    let requestId: string;
    if (requesterKind === "human") {
      const { payload, headers } = multipart(
        { title: c.case_id, policySlug: "kolvarra-risk" },
        caseDocs(c)
      );
      const response = await as("requester", {
        method: "POST",
        url: "/api/v1/requests",
        payload,
        headers,
      });
      expect(response.statusCode).toBe(200);
      requestId = (response.json() as { id: string }).id;
    } else {
      // Phase 3: the agent submits over REST with its API key — same
      // pipeline, initiator_kind=agent flows from the principal.
      const { payload, headers } = multipart(
        { title: c.case_id, policySlug: "kolvarra-risk" },
        caseDocs(c)
      );
      const response = await as("agent", {
        method: "POST",
        url: "/api/v1/requests",
        payload,
        headers,
      });
      expect(response.statusCode).toBe(200);
      requestId = (response.json() as { id: string }).id;
    }
    await pollState("requester", requestId, "facts_review");
    const detail = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
    const body = detail.json() as { factSets: Array<{ id: string; status: string }> };
    const draft = body.factSets.find((fs) => fs.status === "draft")!;
    return { requestId, factSetId: draft.id };
  }

  beforeAll(async () => {
    // Own database for this suite (parallel-safe); buildApp migrates it.
    const fresh = await freshTestDb("server");
    await fresh.close();
    pool = new pg.Pool({ connectionString: testDatabaseUrlFor("server") });
    const env = loadEnv({
      DATABASE_URL: testDatabaseUrlFor("server"),
      BLOB_DIR: mkdtempSync(path.join(tmpdir(), "ddas-blobs-")),
      DDAS_ADMIN_EMAIL: "admin@kolvarra.test",
      DDAS_ADMIN_PASSWORD: "admin-password-123",
      LOG_LEVEL: "error",
      WEBHOOK_POLL_MS: "50",
      WEBHOOK_RETRY_BASE_MS: "10",
      // This suite polls rapidly on purpose — rate limits get their own
      // dedicated e2e (rate-limit.e2e.test.ts) with tight limits.
      RATE_LIMIT_AUTH_LIMIT: "100000",
      RATE_LIMIT_MUTATION_LIMIT: "100000",
      RATE_LIMIT_READ_LIMIT: "100000",
      RATE_LIMIT_ADMIN_LIMIT: "100000",
    });
    app = await buildApp({ pool, env, extractionProvider: provider });
    await bootstrapAdmin(pool, env);
    await app.ready();

    // --- login admin, build the org, register + activate the policy ---
    await login("admin", "admin@kolvarra.test", "admin-password-123");

    const mk = async (name: string, roles: string[]) => {
      const response = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: {
          kind: "human",
          name,
          email: `${name.toLowerCase()}@kolvarra.test`,
          password: `${name.toLowerCase()}-password-123`,
          roles,
        },
      });
      expect(response.statusCode).toBe(200);
      principalIds[name.toLowerCase()] = (response.json() as { id: string }).id;
    };
    await mk("Ruben", ["requester"]); // procurement requester
    await mk("Tomas", ["approver"]); // team lead, tier 1
    await mk("Petra", ["approver"]); // plant director, tier 2
    await mk("Carla", ["approver"]); // CFO, tier 3
    await mk("Sofie", ["approver"]); // supervisory board
    await mk("Bram", ["approver"]); // supervisory board
    await mk("Astrid", ["auditor"]);
    await mk("Mallory", ["requester"]); // a DIFFERENT requester — must not see Ruben's data
    await mk("Vera", ["viewer"]); // read-only: sees everything, touches nothing

    const agent = await as("admin", {
      method: "POST",
      url: "/api/v1/admin/principals",
      payload: {
        kind: "agent",
        name: "procure-bot",
        ownerPrincipalId: principalIds["ruben"],
        roles: ["requester"],
      },
    });
    principalIds["agent"] = (agent.json() as { id: string }).id;

    const key = await as("admin", {
      method: "POST",
      url: "/api/v1/admin/api-keys",
      payload: {
        principalId: principalIds["agent"],
        scopes: ["requests:read", "requests:write", "facts:attest", "mcp"],
      },
    });
    expect(key.statusCode).toBe(200);
    agentToken = (key.json() as { token: string }).token;

    const unit = await as("admin", {
      method: "POST",
      url: "/api/v1/org/units",
      payload: { name: "Kolvarra Industrial Systems B.V." },
    });
    rootUnitId = (unit.json() as { id: string }).id;

    const seat = async (title: string, tier: number, holder: string) => {
      const position = await as("admin", {
        method: "POST",
        url: "/api/v1/org/positions",
        payload: { orgUnitId: rootUnitId, title, authorityTier: tier },
      });
      const assignment = await as("admin", {
        method: "POST",
        url: "/api/v1/org/position-assignments",
        payload: {
          positionId: (position.json() as { id: string }).id,
          principalId: principalIds[holder],
          validFrom: "2020-01-01T00:00:00.000Z",
        },
      });
      expect(assignment.statusCode).toBe(200);
    };
    await seat("Team Lead", 1, "tomas");
    await seat("Plant Director", 2, "petra");
    await seat("CFO", 3, "carla");
    await seat("Supervisory Board Seat A", 4, "sofie");
    await seat("Supervisory Board Seat B", 4, "bram");

    await as("admin", {
      method: "PUT",
      url: "/api/v1/admin/settings",
      payload: { slaHoursByTier: { "1": 24, "2": 24, "3": 48, "4": 72 } },
    });

    const draft = await as("admin", {
      method: "POST",
      url: "/api/v1/policies/kolvarra-risk/versions",
      payload: { sourceYaml: kolvarraYaml },
    });
    expect(draft.statusCode).toBe(200);
    policyVersionId = (draft.json() as { id: string }).id;
    const activation = await as("admin", {
      method: "POST",
      url: `/api/v1/policy-versions/${policyVersionId}/activate`,
      payload: { overrideReason: "initial bootstrap — no history to simulate yet" },
    });
    expect(activation.statusCode).toBe(200);

    await login("requester", "ruben@kolvarra.test", "ruben-password-123");
    await login("petra", "petra@kolvarra.test", "petra-password-123");
    await login("auditor", "astrid@kolvarra.test", "astrid-password-123");
    await login("mallory", "mallory@kolvarra.test", "mallory-password-123");
    await login("viewer", "vera@kolvarra.test", "vera-password-123");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("rejects unauthenticated access and wrong roles", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/v1/requests" });
    expect(anonymous.statusCode).toBe(401);
    const wrongRole = await as("requester", { method: "GET", url: "/api/v1/audit/events" });
    expect(wrongRole.statusCode).toBe(403);
  });

  it("returns the session principal with roles as a real array", async () => {
    const me = await as("requester", { method: "GET", url: "/api/v1/auth/me" });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { name: string; roles: string[] };
    expect(body.name).toBe("Ruben");
    expect(body.roles).toEqual(["requester"]);
  });

  it("runs the flagship case end-to-end: submit → review → classify → approve", async () => {
    const flagship = loadCase("vendor-msa-high-value");
    const { requestId, factSetId } = await submitCase(flagship, "human");

    // Fact review: the extracted facts match the labels (citations grounded).
    const detail = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
    const facts = (detail.json() as {
      factSets: Array<{ id: string; facts: Array<{ factId: string; status: string; citation: { text: string } | null }> }>;
    }).factSets.find((fs) => fs.id === factSetId)!.facts;
    const amount = facts.find((f) => f.factId === "amount_base_total")!;
    expect(amount.status).toBe("FOUND");
    expect(amount.citation?.text).toContain("2,000,000");

    // Confirm → synchronous classify → approval task at tier 2.
    const confirm = await as("requester", {
      method: "POST",
      url: `/api/v1/fact-sets/${factSetId}/confirm`,
      payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    const outcome = confirm.json() as {
      status: string;
      tier: number;
      routing: { kind: string; taskId: string; quorum: number; routingFailed: boolean };
    };
    expect(outcome.status).toBe("ROUTED");
    expect(outcome.tier).toBe(2);
    expect(outcome.routing.kind).toBe("task_created");
    expect(outcome.routing.routingFailed).toBe(false);

    // Confirmed fact set is frozen even over HTTP.
    const frozenPatch = await as("requester", {
      method: "PATCH",
      url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
      payload: { status: "NOT_FOUND" },
    });
    expect(frozenPatch.statusCode).toBe(409);

    // Petra (plant director, tier 2) sees it in her inbox and approves.
    const inbox = await as("petra", { method: "GET", url: "/api/v1/approvals/inbox" });
    const tasks = inbox.json() as Array<{ id: string; requestId: string }>;
    const task = tasks.find((t) => t.requestId === requestId)!;
    expect(task).toBeDefined();
    const approve = await as("petra", {
      method: "POST",
      url: `/api/v1/approval-tasks/${task.id}/approve`,
      payload: { comment: "within plant budget" },
    });
    expect(approve.statusCode).toBe(200);
    expect((approve.json() as { verdict: string }).verdict).toBe("approved");

    const decided = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
    const body = decided.json() as { state: string; decision: { outcome: string } };
    expect(body.state).toBe("decided");
    expect(body.decision.outcome).toBe("approved");

    // Replay: the audit procedure as an endpoint.
    const classification = (decided.json() as { classifications: Array<{ id: string }> })
      .classifications[0]!;
    const replay = await as("auditor", {
      method: "POST",
      url: `/api/v1/classifications/${classification.id}/replay`,
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { match: boolean }).match).toBe(true);
  }, 60_000);

  it("deny wins: a single reject decides the task immediately", async () => {
    const c = loadCase("vendor-msa-high-value-para");
    const { requestId, factSetId } = await submitCase(c, "human");
    const confirm = await as("requester", {
      method: "POST",
      url: `/api/v1/fact-sets/${factSetId}/confirm`,
      payload: {},
    });
    const { routing } = confirm.json() as { routing: { taskId: string } };
    const reject = await as("petra", {
      method: "POST",
      url: `/api/v1/approval-tasks/${routing.taskId}/reject`,
      payload: { comment: "renegotiate the cap first" },
    });
    expect((reject.json() as { verdict: string }).verdict).toBe("rejected");
    const decided = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
    expect((decided.json() as { decision: { outcome: string } }).decision.outcome).toBe("rejected");
  }, 60_000);

  it("replays the whole Kolvarra corpus over HTTP with expected tiers", async () => {
    const caseIds = [
      "routine-spares-po",
      "human-procurement-same-facts",
      "agent-procurement-same-facts",
      "sanctions-adjacent-distributor",
      "uncapped-liability-tooling",
      "novel-jv-proposal",
      "accumulation-plant-retrofit",
      "missing-termination-escalate",
      "missing-regulated-needs-info",
      "adversarial-split-annex",
      "adversarial-euphemistic-termination",
      "adversarial-voided-cap",
    ];
    for (const caseId of caseIds) {
      const c = loadCase(caseId);
      const initiator = c.expected_routing.initiator_kind ?? "human";
      const { requestId, factSetId } = await submitCase(c, initiator);
      if (initiator === "agent") {
        // Compliant agent flow: the policy requires counterparty_name to be
        // HUMAN-attested on agent-initiated requests — the owner attests it.
        const label = c.labeled_facts.find((f) => f.id === "counterparty_name")!;
        const attest = await as("requester", {
          method: "PATCH",
          url: `/api/v1/fact-sets/${factSetId}/facts/counterparty_name`,
          payload: { status: "MANUAL", value: label.value },
        });
        expect(attest.statusCode, `${caseId} attestation`).toBe(200);
      }
      const confirm = await as("requester", {
        method: "POST",
        url: `/api/v1/fact-sets/${factSetId}/confirm`,
        payload: {},
      });
      expect(confirm.statusCode, caseId).toBe(200);
      const outcome = confirm.json() as {
        status: string;
        tier: number | null;
        classificationId: string;
        routing: { kind: string };
      };
      const expected = c.expected_routing.expected;
      expect(outcome.status, caseId).toBe(expected.status);
      if (expected.status === "ROUTED") {
        expect(outcome.tier, caseId).toBe(expected.tier);
        if (expected.binding_category) {
          const classification = await as("auditor", {
            method: "GET",
            url: `/api/v1/classifications/${outcome.classificationId}`,
          });
          const derivation = (classification.json() as {
            derivation: { composition: { baseTier: { bindingCategory: string } } };
          }).derivation;
          expect(derivation.composition.baseTier.bindingCategory, caseId).toBe(
            expected.binding_category
          );
        }
        if (expected.tier === 0) {
          const detail = await as("requester", {
            method: "GET",
            url: `/api/v1/requests/${requestId}`,
          });
          expect((detail.json() as { decision: { outcome: string } }).decision.outcome, caseId).toBe(
            "auto_approved"
          );
        }
      } else {
        // INCOMPLETE: routing blocked, request stays in facts_review.
        const detail = await as("requester", {
          method: "GET",
          url: `/api/v1/requests/${requestId}`,
        });
        expect((detail.json() as { state: string }).state, caseId).toBe("facts_review");
      }
    }
  }, 240_000);

  it("simulates a candidate policy against stored fact sets without the LLM", async () => {
    const simulation = await as("admin", {
      method: "POST",
      url: "/api/v1/simulations",
      payload: { baselinePolicyVersionId: policyVersionId, candidateYaml: kolvarraYaml },
    });
    expect(simulation.statusCode).toBe(200);
    const { id } = simulation.json() as { id: string };

    let run: { status: string; summary: { factSets: number; changed: number } | null; results: unknown[] } | null = null;
    for (let i = 0; i < 100; i++) {
      const poll = await as("admin", { method: "GET", url: `/api/v1/simulations/${id}` });
      run = poll.json() as typeof run;
      if (run!.status === "done" || run!.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(run!.status).toBe("done");
    // Identical candidate → zero tier changes across every stored fact set.
    expect(run!.summary!.changed).toBe(0);
    expect(run!.summary!.factSets).toBeGreaterThan(10);

    // A simulated draft can now activate WITHOUT an override reason.
    const draft2 = await as("admin", {
      method: "POST",
      url: "/api/v1/policies/kolvarra-risk/versions",
      payload: { sourceYaml: kolvarraYaml },
    });
    const v2 = (draft2.json() as { id: string }).id;
    const activate = await as("admin", {
      method: "POST",
      url: `/api/v1/policy-versions/${v2}/activate`,
      payload: { simulationRunId: id },
    });
    expect(activate.statusCode).toBe(200);
  }, 120_000);

  it("keeps the audit chain verifiable after the whole run", async () => {
    const verify = await as("auditor", { method: "POST", url: "/api/v1/audit/verify", payload: {} });
    expect(verify.statusCode).toBe(200);
    const result = verify.json() as { ok: boolean; checked: number };
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(50);

    const checkpoint = await as("auditor", { method: "GET", url: "/api/v1/audit/checkpoint" });
    expect(checkpoint.statusCode).toBe(200);
    expect((checkpoint.json() as { seq: number }).seq).toBeGreaterThan(0);
  });

  describe("multi-tenant confinement (review regression)", () => {
    it("blocks a different requester from reading or mutating someone else's request", async () => {
      const c = loadCase("routine-spares-po");
      const { requestId, factSetId } = await submitCase(c, "human"); // owned by Ruben

      // Mallory (a bare requester, not the owner) is denied every surface.
      const read = await as("mallory", { method: "GET", url: `/api/v1/requests/${requestId}` });
      expect(read.statusCode).toBe(403);

      const patch = await as("mallory", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
        payload: { status: "NOT_FOUND" },
      });
      expect(patch.statusCode).toBe(403);

      const confirm = await as("mallory", {
        method: "POST",
        url: `/api/v1/fact-sets/${factSetId}/confirm`,
        payload: {},
      });
      expect(confirm.statusCode).toBe(403);

      const clone = await as("mallory", {
        method: "POST",
        url: `/api/v1/fact-sets/${factSetId}/clone`,
      });
      expect(clone.statusCode).toBe(403);

      // The owner still can (sanity: the guard isn't just denying everyone).
      const ownerRead = await as("requester", {
        method: "GET",
        url: `/api/v1/requests/${requestId}`,
      });
      expect(ownerRead.statusCode).toBe(200);
    }, 60_000);
  });

  describe("viewer role (read-only)", () => {
    it("reads everything an admin can read — including other users' requests", async () => {
      // Roles come back as a REAL array (regression: array_agg over the enum
      // used to return an unparsed '{...}' string that broke role gates).
      const me = await as("viewer", { method: "GET", url: "/api/v1/auth/me" });
      expect(me.statusCode).toBe(200);
      const body = me.json() as { roles: string[] };
      expect(Array.isArray(body.roles)).toBe(true);
      expect(body.roles).toEqual(["viewer"]);

      // A request owned by Ruben, confirmed through to a classification.
      const c = loadCase("routine-spares-po");
      const { requestId, factSetId } = await submitCase(c, "human");
      const confirm = await as("requester", {
        method: "POST",
        url: `/api/v1/fact-sets/${factSetId}/confirm`,
        payload: {},
      });
      expect(confirm.statusCode).toBe(200);
      const classificationId = (confirm.json() as { classificationId: string }).classificationId;

      const list = await as("viewer", { method: "GET", url: "/api/v1/requests" });
      expect(list.statusCode).toBe(200);
      expect((list.json() as unknown[]).length).toBeGreaterThan(0);

      const detail = await as("viewer", { method: "GET", url: `/api/v1/requests/${requestId}` });
      expect(detail.statusCode).toBe(200);
      const docs = (detail.json() as { documents: Array<{ id: string }> }).documents;

      const text = await as("viewer", {
        method: "GET",
        url: `/api/v1/documents/${docs[0]!.id}/text`,
      });
      expect(text.statusCode).toBe(200);

      const classification = await as("viewer", {
        method: "GET",
        url: `/api/v1/classifications/${classificationId}`,
      });
      expect(classification.statusCode).toBe(200);
      expect((classification.json() as { derivation: unknown }).derivation).toBeDefined();

      const policies = await as("viewer", { method: "GET", url: "/api/v1/policies" });
      expect(policies.statusCode).toBe(200);
      const versions = await as("viewer", {
        method: "GET",
        url: "/api/v1/policies/kolvarra-risk/versions",
      });
      expect(versions.statusCode).toBe(200);
      const version = await as("viewer", {
        method: "GET",
        url: `/api/v1/policy-versions/${policyVersionId}`,
      });
      expect(version.statusCode).toBe(200);

      const org = await as("viewer", { method: "GET", url: "/api/v1/org/tree" });
      expect(org.statusCode).toBe(200);
    }, 60_000);

    it("gets 403 on every write class and on role-gated surfaces", async () => {
      // A live target owned by Ruben, left in facts_review (draft fact set).
      const c = loadCase("routine-spares-po");
      const { requestId, factSetId } = await submitCase(c, "human");
      const anyUuid = "00000000-0000-4000-8000-000000000000";

      const expect403 = async (
        label: string,
        opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }
      ) => {
        const response = await as("viewer", opts);
        expect(response.statusCode, label).toBe(403);
      };

      // Requests / facts — no submit, attest, confirm, clone, or cancel.
      const { payload, headers } = multipart(
        { title: "viewer write probe", policySlug: "kolvarra-risk" },
        [{ filename: "x.txt", content: "hello" }]
      );
      await expect403("submit", { method: "POST", url: "/api/v1/requests", payload, headers });
      await expect403("attest", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
        payload: { status: "NOT_FOUND" },
      });
      await expect403("confirm", {
        method: "POST",
        url: `/api/v1/fact-sets/${factSetId}/confirm`,
        payload: {},
      });
      await expect403("clone", { method: "POST", url: `/api/v1/fact-sets/${factSetId}/clone` });
      await expect403("cancel", { method: "POST", url: `/api/v1/requests/${requestId}/cancel` });
      await expect403("replay", {
        method: "POST",
        url: `/api/v1/classifications/${anyUuid}/replay`,
        payload: {},
      });

      // Approvals — not even the read surfaces (that is approver/auditor work).
      await expect403("inbox", { method: "GET", url: "/api/v1/approvals/inbox" });
      await expect403("task detail", { method: "GET", url: `/api/v1/approval-tasks/${anyUuid}` });
      await expect403("approve", {
        method: "POST",
        url: `/api/v1/approval-tasks/${anyUuid}/approve`,
        payload: {},
      });
      await expect403("reject", {
        method: "POST",
        url: `/api/v1/approval-tasks/${anyUuid}/reject`,
        payload: { comment: "no" },
      });

      // Policy authoring & simulation.
      await expect403("lint", {
        method: "POST",
        url: "/api/v1/policies/lint",
        payload: { sourceYaml: "x: 1" },
      });
      await expect403("draft version", {
        method: "POST",
        url: "/api/v1/policies/kolvarra-risk/versions",
        payload: { sourceYaml: "x: 1" },
      });
      await expect403("activate", {
        method: "POST",
        url: `/api/v1/policy-versions/${anyUuid}/activate`,
        payload: { overrideReason: "viewer must never activate" },
      });
      await expect403("retire", {
        method: "POST",
        url: `/api/v1/policy-versions/${anyUuid}/retire`,
      });
      await expect403("simulate", {
        method: "POST",
        url: "/api/v1/simulations",
        payload: { baselinePolicyVersionId: anyUuid, candidateYaml: "x: 1" },
      });

      // Org writes.
      await expect403("org unit", {
        method: "POST",
        url: "/api/v1/org/units",
        payload: { name: "Viewer Unit" },
      });
      await expect403("org position", {
        method: "POST",
        url: "/api/v1/org/positions",
        payload: { orgUnitId: anyUuid, title: "X", authorityTier: 1 },
      });
      await expect403("org assignment", {
        method: "POST",
        url: "/api/v1/org/position-assignments",
        payload: {
          positionId: anyUuid,
          principalId: anyUuid,
          validFrom: "2020-01-01T00:00:00.000Z",
        },
      });
      await expect403("org delegation", {
        method: "POST",
        url: "/api/v1/org/delegations",
        payload: {
          fromPrincipalId: anyUuid,
          toPrincipalId: anyUuid,
          maxTier: 1,
          validFrom: "2020-01-01T00:00:00.000Z",
          reason: "nope",
        },
      });
      await expect403("revoke delegation", {
        method: "DELETE",
        url: `/api/v1/org/delegations/${anyUuid}`,
      });
      await expect403("org import", {
        method: "POST",
        url: "/api/v1/org/import",
        payload: { units: [], people: [], positions: [] },
      });

      // Audit-chain endpoints stay the auditor's job.
      await expect403("audit events", { method: "GET", url: "/api/v1/audit/events" });
      await expect403("audit verify", { method: "POST", url: "/api/v1/audit/verify", payload: {} });
      await expect403("audit checkpoint", { method: "GET", url: "/api/v1/audit/checkpoint" });

      // Admin surfaces (including the secrets: API keys, webhooks, SCIM-ish config).
      await expect403("principals list", { method: "GET", url: "/api/v1/admin/principals" });
      await expect403("principal create", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: { kind: "human", name: "X", email: "x@x.test" },
      });
      await expect403("role edit", {
        method: "POST",
        url: `/api/v1/admin/principals/${anyUuid}/roles`,
        payload: { roles: ["viewer"] },
      });
      await expect403("api keys list", { method: "GET", url: "/api/v1/admin/api-keys" });
      await expect403("api key mint", {
        method: "POST",
        url: "/api/v1/admin/api-keys",
        payload: { principalId: anyUuid, scopes: ["requests:read"] },
      });
      await expect403("api key revoke", {
        method: "DELETE",
        url: `/api/v1/admin/api-keys/${anyUuid}`,
      });
      await expect403("settings read", { method: "GET", url: "/api/v1/admin/settings" });
      await expect403("settings write", {
        method: "PUT",
        url: "/api/v1/admin/settings",
        payload: { slaHoursByTier: { "1": 24 } },
      });
      await expect403("webhooks list", { method: "GET", url: "/api/v1/admin/webhooks" });
      await expect403("webhook create", {
        method: "POST",
        url: "/api/v1/admin/webhooks",
        payload: { url: "http://127.0.0.1:9/x", events: ["decision.recorded"] },
      });
      await expect403("webhook delete", {
        method: "DELETE",
        url: `/api/v1/admin/webhooks/${anyUuid}`,
      });
      await expect403("webhook deliveries", {
        method: "GET",
        url: `/api/v1/admin/webhooks/${anyUuid}/deliveries`,
      });
      await expect403("webhook redeliver", {
        method: "POST",
        url: `/api/v1/admin/webhook-deliveries/${anyUuid}/redeliver`,
      });
    }, 60_000);
  });

  describe("configurable RBAC (ADR 0005)", () => {
    const anyUuid = "00000000-0000-4000-8000-000000000000";

    it("lists built-ins read-only with their permission sets; viewer reads nothing here", async () => {
      const list = await as("admin", { method: "GET", url: "/api/v1/admin/roles" });
      expect(list.statusCode).toBe(200);
      const roles = list.json() as Array<{
        id: string;
        name: string;
        builtin: boolean;
        permissions: string[];
      }>;
      const builtins = roles.filter((r) => r.builtin);
      expect(builtins.map((r) => r.name).sort()).toEqual([
        "admin",
        "approver",
        "auditor",
        "policy_author",
        "requester",
        "viewer",
      ]);
      const approver = builtins.find((r) => r.name === "approver")!;
      expect(approver.id).toBe("builtin:approver");
      expect(approver.permissions).toContain("decisions.decide");
      expect(approver.permissions).toContain("facts.attest");
      const admin = builtins.find((r) => r.name === "admin")!;
      expect(admin.permissions).toContain("admin.api_keys");

      const asViewer = await as("viewer", { method: "GET", url: "/api/v1/admin/roles" });
      expect(asViewer.statusCode).toBe(403);
    });

    it("refuses admin.* grants, unknown permissions, built-in names, and built-in edits", async () => {
      const adminGrant = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: { name: "Shadow Admin", permissions: ["admin.api_keys"] },
      });
      expect(adminGrant.statusCode).toBe(422);

      const unknown = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: { name: "Futurist", permissions: ["future.shiny"] },
      });
      expect(unknown.statusCode).toBe(422);

      const builtinName = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: { name: "approver", permissions: ["requests.read"] },
      });
      expect(builtinName.statusCode).toBe(422);

      const editBuiltin = await as("admin", {
        method: "PUT",
        url: "/api/v1/admin/roles/builtin:approver",
        payload: { permissions: ["requests.read"] },
      });
      expect(editBuiltin.statusCode).toBe(422);

      const deleteBuiltin = await as("admin", {
        method: "DELETE",
        url: "/api/v1/admin/roles/builtin:approver",
      });
      expect(deleteBuiltin.statusCode).toBe(422);

      const missing = await as("admin", {
        method: "PUT",
        url: `/api/v1/admin/roles/${anyUuid}`,
        payload: { description: "x" },
      });
      expect(missing.statusCode).toBe(404);
    });

    it("runs the full custom-role lifecycle: create → assign → gate → widen → attest → revoke → audit", async () => {
      // -- create: wide read only --
      const created = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: {
          name: "External Reviewer",
          description: "read-only reviewer from the audit firm",
          permissions: ["requests.read"],
        },
      });
      expect(created.statusCode).toBe(200);
      const roleId = (created.json() as { id: string }).id;

      const duplicate = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: { name: "external reviewer", permissions: [] },
      });
      expect(duplicate.statusCode).toBe(409);

      // -- a principal with NO built-in roles, only the custom role --
      const principal = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: {
          kind: "human",
          name: "Nadia",
          email: "nadia@kolvarra.test",
          password: "nadia-password-123",
          roles: [],
        },
      });
      expect(principal.statusCode).toBe(200);
      const nadiaId = (principal.json() as { id: string }).id;
      const assigned = await as("admin", {
        method: "POST",
        url: `/api/v1/admin/principals/${nadiaId}/custom-roles`,
        payload: { roleIds: [roleId] },
      });
      expect(assigned.statusCode).toBe(200);
      expect((assigned.json() as { customRoles: Array<{ id: string }> }).customRoles).toEqual([
        { id: roleId, name: "External Reviewer" },
      ]);
      await login("nadia", "nadia@kolvarra.test", "nadia-password-123");

      // deleting a role that has members is refused (409) — documented in scim.md
      const deleteWithMembers = await as("admin", {
        method: "DELETE",
        url: `/api/v1/admin/roles/${roleId}`,
      });
      expect(deleteWithMembers.statusCode).toBe(409);

      // -- a live request owned by Ruben, in facts_review --
      const c = loadCase("routine-spares-po");
      const { requestId, factSetId } = await submitCase(c, "human");

      // holder READS (wide visibility)…
      const read = await as("nadia", { method: "GET", url: `/api/v1/requests/${requestId}` });
      expect(read.statusCode).toBe(200);

      // …but 403s everywhere else (deny-by-default over the catalog).
      const { payload, headers } = multipart(
        { title: "custom-role write probe", policySlug: "kolvarra-risk" },
        [{ filename: "x.txt", content: "hello" }]
      );
      const probes: Array<[string, { method: string; url: string; payload?: unknown; headers?: Record<string, string> }]> = [
        ["submit", { method: "POST", url: "/api/v1/requests", payload, headers }],
        [
          "attest",
          {
            method: "PATCH",
            url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
            payload: { status: "MANUAL", value: 9500 },
          },
        ],
        ["inbox", { method: "GET", url: "/api/v1/approvals/inbox" }],
        ["audit", { method: "GET", url: "/api/v1/audit/events" }],
        ["replay", { method: "POST", url: `/api/v1/classifications/${anyUuid}/replay`, payload: {} }],
        ["roles admin", { method: "GET", url: "/api/v1/admin/roles" }],
        ["principals", { method: "GET", url: "/api/v1/admin/principals" }],
      ];
      for (const [label, opts] of probes) {
        const response = await as("nadia", opts);
        expect(response.statusCode, label).toBe(403);
      }

      // -- widen the SAME role: + facts.attest — takes effect on next request --
      const widened = await as("admin", {
        method: "PUT",
        url: `/api/v1/admin/roles/${roleId}`,
        payload: { permissions: ["requests.read", "facts.attest"] },
      });
      expect(widened.statusCode).toBe(200);

      const attest = await as("nadia", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
        payload: { status: "MANUAL", value: 9500 },
      });
      expect(attest.statusCode).toBe(200);

      // -- revoke the assignment: everything 403s again --
      const revoked = await as("admin", {
        method: "POST",
        url: `/api/v1/admin/principals/${nadiaId}/custom-roles`,
        payload: { roleIds: [] },
      });
      expect(revoked.statusCode).toBe(200);
      const readAfter = await as("nadia", {
        method: "GET",
        url: `/api/v1/requests/${requestId}`,
      });
      expect(readAfter.statusCode).toBe(403);
      const attestAfter = await as("nadia", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/amount_base_total`,
        payload: { status: "MANUAL", value: 9500 },
      });
      expect(attestAfter.statusCode).toBe(403);

      // -- the definition + membership changes are all on the audit chain --
      const expectAuditEvent = async (type: string) => {
        const events = await as("auditor", {
          method: "GET",
          url: `/api/v1/audit/events?type=${encodeURIComponent(type)}&limit=500`,
        });
        expect(events.statusCode).toBe(200);
        expect((events.json() as unknown[]).length, type).toBeGreaterThan(0);
      };
      await expectAuditEvent("role.created");
      await expectAuditEvent("role.updated");
      await expectAuditEvent("role.assigned");
      await expectAuditEvent("role.revoked");

      // -- with no members left, deletion succeeds and is audited --
      const deleted = await as("admin", {
        method: "DELETE",
        url: `/api/v1/admin/roles/${roleId}`,
      });
      expect(deleted.statusCode).toBe(200);
      await expectAuditEvent("role.deleted");
    }, 60_000);

    it("refuses an agent granted decisions.decide from deciding (authz-S1)", async () => {
      // decisions.decide is grantable to custom roles, so permission alone no
      // longer proves human-ness. Give an AGENT that permission and prove it
      // still cannot approve or reject — "agents never decide" is enforced by
      // principal kind, defense-in-depth over the permission gate.
      const role = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/roles",
        payload: { name: "Auto Decider", permissions: ["decisions.decide"] },
      });
      expect(role.statusCode).toBe(200);
      const roleId = (role.json() as { id: string }).id;

      const bot = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: {
          kind: "agent",
          name: "decider-bot",
          ownerPrincipalId: principalIds["ruben"],
          roles: [],
        },
      });
      expect(bot.statusCode).toBe(200);
      const botId = (bot.json() as { id: string }).id;
      await as("admin", {
        method: "POST",
        url: `/api/v1/admin/principals/${botId}/custom-roles`,
        payload: { roleIds: [roleId] },
      });
      const key = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/api-keys",
        payload: { principalId: botId, scopes: ["requests:read"] },
      });
      const botToken = (key.json() as { token: string }).token;

      // The kind guard fires before any task lookup, so a placeholder id is fine.
      const approve = await app.inject({
        method: "POST",
        url: `/api/v1/approval-tasks/${anyUuid}/approve`,
        headers: { authorization: `Bearer ${botToken}` },
        payload: {},
      });
      expect(approve.statusCode).toBe(403);
      expect((approve.json() as { error: { message: string } }).error.message).toContain(
        "agents cannot approve"
      );

      const reject = await app.inject({
        method: "POST",
        url: `/api/v1/approval-tasks/${anyUuid}/reject`,
        headers: { authorization: `Bearer ${botToken}` },
        payload: { comment: "nope" },
      });
      expect(reject.statusCode).toBe(403);
      expect((reject.json() as { error: { message: string } }).error.message).toContain(
        "agents cannot reject"
      );
    });
  });

  describe("simulation activation gate (review regression)", () => {
    it("rejects a run whose candidate does not match the version being activated", async () => {
      // A completed run whose candidate is the CURRENT active policy (unchanged).
      const sim = await as("admin", {
        method: "POST",
        url: "/api/v1/simulations",
        payload: { baselinePolicyVersionId: policyVersionId, candidateYaml: kolvarraYaml },
      });
      const runId = (sim.json() as { id: string }).id;
      await waitFor(async () => {
        const poll = await as("admin", { method: "GET", url: `/api/v1/simulations/${runId}` });
        return (poll.json() as { status: string }).status === "done";
      }, 30_000);

      // A brand-new DRAFT that changes the policy (different content hash).
      const tweakedYaml = kolvarraYaml.replace("name: Kolvarra", "name: Kolvarra Tweaked");
      const draft = await as("admin", {
        method: "POST",
        url: "/api/v1/policies/kolvarra-risk/versions",
        payload: { sourceYaml: tweakedYaml },
      });
      const draftId = (draft.json() as { id: string }).id;

      // Activating the tweaked draft with the run that tested the UNCHANGED
      // policy must be refused — the run did not test this candidate.
      const activate = await as("admin", {
        method: "POST",
        url: `/api/v1/policy-versions/${draftId}/activate`,
        payload: { simulationRunId: runId },
      });
      expect(activate.statusCode).toBe(409);
      expect((activate.json() as { error: { message: string } }).error.message).toMatch(
        /different candidate/
      );
    }, 60_000);
  });

  describe("API keys (Phase 3)", () => {
    it("rejects bad tokens, wrong scopes, and revoked keys", async () => {
      const bad = await app.inject({
        method: "GET",
        url: "/api/v1/requests",
        headers: { authorization: "Bearer ddas_deadbeef_0000000000000000" },
      });
      expect(bad.statusCode).toBe(401);

      const readOnly = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/api-keys",
        payload: { principalId: principalIds["agent"], scopes: ["requests:read"] },
      });
      const readToken = (readOnly.json() as { token: string; id: string });

      const list = await app.inject({
        method: "GET",
        url: "/api/v1/requests",
        headers: { authorization: `Bearer ${readToken.token}` },
      });
      expect(list.statusCode).toBe(200);

      const { payload, headers } = multipart(
        { title: "scope test", policySlug: "kolvarra-risk" },
        [{ filename: "x.txt", content: "hello" }]
      );
      const write = await app.inject({
        method: "POST",
        url: "/api/v1/requests",
        payload,
        headers: { ...headers, authorization: `Bearer ${readToken.token}` },
      });
      expect(write.statusCode).toBe(403);
      expect((write.json() as { error: { message: string } }).error.message).toMatch(/scope/);

      const revoke = await as("admin", {
        method: "DELETE",
        url: `/api/v1/admin/api-keys/${readToken.id}`,
      });
      expect(revoke.statusCode).toBe(200);
      const afterRevoke = await app.inject({
        method: "GET",
        url: "/api/v1/requests",
        headers: { authorization: `Bearer ${readToken.token}` },
      });
      expect(afterRevoke.statusCode).toBe(401);
    });

    it("refuses an agent attesting an attestation-required fact", async () => {
      const c = loadCase("agent-procurement-same-facts");
      const { factSetId } = await submitCase(c, "agent");

      // The agent may attest ordinary facts…
      const ordinary = await as("agent", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/contract_term_months`,
        payload: { status: "MANUAL", value: 12 },
      });
      expect(ordinary.statusCode).toBe(200);

      // …but counterparty_name is attestation_required: humans only.
      const gated = await as("agent", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/counterparty_name`,
        payload: { status: "MANUAL", value: "Vosskamp Precision Castings GmbH" },
      });
      expect(gated.statusCode).toBe(403);
      expect((gated.json() as { error: { message: string } }).error.message).toMatch(
        /accountable human/
      );

      // The accountable human owner attests it fine.
      const human = await as("requester", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${factSetId}/facts/counterparty_name`,
        payload: { status: "MANUAL", value: "Vosskamp Precision Castings GmbH" },
      });
      expect(human.statusCode).toBe(200);
    });
  });

  describe("webhooks (Phase 3)", () => {
    interface Hit {
      body: string;
      signature: string;
      deliveryId: string;
      eventType: string;
    }

    it("delivers signed events, retries to dead, then redelivers on demand", async () => {
      const hits: Hit[] = [];
      let failing = false;
      const receiver = http.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk: Buffer) => (body += chunk.toString()));
        request.on("end", () => {
          hits.push({
            body,
            signature: String(request.headers["x-ddas-signature"]),
            deliveryId: String(request.headers["x-ddas-delivery"]),
            eventType: String(request.headers["x-ddas-event"]),
          });
          response.statusCode = failing ? 500 : 200;
          response.end();
        });
      });
      await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
      const port = (receiver.address() as { port: number }).port;
      const secret = "e2e-webhook-secret-0123456789";

      const hook = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/webhooks",
        payload: {
          url: `http://127.0.0.1:${port}/hook`,
          events: ["org_unit.created"],
          secret,
        },
      });
      expect(hook.statusCode).toBe(200);
      const webhookId = (hook.json() as { id: string }).id;

      // Unknown event names are refused (closed union).
      const badEvents = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/webhooks",
        payload: { url: "http://127.0.0.1:9/x", events: ["nope.nope"] },
      });
      expect(badEvents.statusCode).toBe(422);

      // Trigger: create a unit -> fanout row in the same tx -> worker sends.
      await as("admin", {
        method: "POST",
        url: "/api/v1/org/units",
        payload: { name: "Webhook Test Unit", parentId: rootUnitId },
      });
      await waitFor(() => hits.length >= 1, 10_000);
      const hit = hits[0]!;
      expect(hit.eventType).toBe("org_unit.created");
      const parsed = JSON.parse(hit.body) as {
        deliveryId: string;
        event: { type: string; payload: { name: string } };
      };
      expect(parsed.event.payload.name).toBe("Webhook Test Unit");
      expect(parsed.deliveryId).toBe(hit.deliveryId);
      // Signature verifies against the raw body.
      const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(hit.signature);
      expect(match).not.toBeNull();
      const recomputed = createHmac("sha256", secret)
        .update(`${match![1]}.${hit.body}`)
        .digest("hex");
      expect(recomputed).toBe(match![2]);

      // Failure path: 500s exhaust 8 attempts -> dead + audit event.
      failing = true;
      const before = hits.length;
      await as("admin", {
        method: "POST",
        url: "/api/v1/org/units",
        payload: { name: "Doomed Unit", parentId: rootUnitId },
      });
      await waitFor(async () => {
        const log = await as("admin", {
          method: "GET",
          url: `/api/v1/admin/webhooks/${webhookId}/deliveries`,
        });
        return (log.json() as Array<{ status: string }>).some((d) => d.status === "dead");
      }, 20_000);
      expect(hits.length - before).toBe(8); // every attempt reached the receiver

      const log = await as("admin", {
        method: "GET",
        url: `/api/v1/admin/webhooks/${webhookId}/deliveries`,
      });
      const dead = (log.json() as Array<{ id: string; status: string; attempts: number }>).find(
        (d) => d.status === "dead"
      )!;
      expect(dead.attempts).toBe(8);

      // Redeliver once the receiver recovers.
      failing = false;
      const redeliver = await as("admin", {
        method: "POST",
        url: `/api/v1/admin/webhook-deliveries/${dead.id}/redeliver`,
      });
      expect(redeliver.statusCode).toBe(200);
      await waitFor(async () => {
        const after = await as("admin", {
          method: "GET",
          url: `/api/v1/admin/webhooks/${webhookId}/deliveries`,
        });
        return (after.json() as Array<{ id: string; status: string }>).some(
          (d) => d.id === dead.id && d.status === "delivered"
        );
      }, 10_000);

      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }, 60_000);
  });

  describe("MCP (Phase 3) — the money demo", () => {
    it("agent requests authority over MCP; a human approves in the inbox; the agent proceeds", async () => {
      // Serve on a real socket — the MCP client speaks HTTP, not inject().
      await app.listen({ port: 0, host: "127.0.0.1" });
      const port = (app.server.address() as { port: number }).port;
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );

      const connect = async (headers: Record<string, string>) => {
        const client = new Client({ name: "e2e-agent", version: "1.0.0" });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
          { requestInit: { headers } }
        );
        await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
        return client;
      };

      // No key → the endpoint refuses before any MCP handshake.
      await expect(connect({})).rejects.toThrow(/401|Unauthorized/i);

      const mcp = await connect({ authorization: `Bearer ${agentToken}` });
      const tools = await mcp.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        "attest_fact",
        "confirm_facts",
        "get_decision_status",
        "list_my_pending_requests",
        "request_authority",
      ]);

      // 1. The agent requests authority for the procurement action.
      const c = loadCase("agent-procurement-same-facts");
      provider.current = c;
      const docs = caseDocs(c).map((d) => ({ name: d.filename, content: d.content }));
      const submitted = await mcp.callTool({
        name: "request_authority",
        arguments: {
          title: "MCP: Vosskamp castings order",
          policy_slug: "kolvarra-risk",
          documents: docs,
        },
      });
      const { request_id } = JSON.parse(
        (submitted.content as Array<{ text: string }>)[0]!.text
      ) as { request_id: string };

      // 2. Poll status until extraction lands the draft facts.
      await waitFor(async () => {
        const status = await mcp.callTool({
          name: "get_decision_status",
          arguments: { request_id },
        });
        const body = JSON.parse((status.content as Array<{ text: string }>)[0]!.text) as {
          state: string;
        };
        return body.state === "facts_review";
      }, 30_000);

      // 3. The agent tries to attest the gated fact — refused; its owner attests.
      const gated = await mcp.callTool({
        name: "attest_fact",
        arguments: {
          request_id,
          fact_id: "counterparty_name",
          value: "Vosskamp Precision Castings GmbH",
        },
      });
      expect(gated.isError).toBe(true);
      expect(JSON.stringify(gated.content)).toMatch(/accountable human/);

      const detail = await as("requester", {
        method: "GET",
        url: `/api/v1/requests/${request_id}`,
      });
      const draftSet = (detail.json() as { factSets: Array<{ id: string; status: string }> })
        .factSets.find((fs) => fs.status === "draft")!;
      const ownerAttest = await as("requester", {
        method: "PATCH",
        url: `/api/v1/fact-sets/${draftSet.id}/facts/counterparty_name`,
        payload: { status: "MANUAL", value: "Vosskamp Precision Castings GmbH" },
      });
      expect(ownerAttest.statusCode).toBe(200);

      // 4. The agent confirms → agent-initiated appetite routes it to tier 2.
      const confirmed = await mcp.callTool({
        name: "confirm_facts",
        arguments: { request_id },
      });
      const outcome = JSON.parse(
        (confirmed.content as Array<{ text: string }>)[0]!.text
      ) as { classification: string; tier: number; routing: { kind: string; taskId: string } };
      expect(outcome.classification).toBe("ROUTED");
      expect(outcome.tier).toBe(2);
      expect(outcome.routing.kind).toBe("task_created");

      // 5. It shows up as pending for the agent…
      const pending = await mcp.callTool({ name: "list_my_pending_requests", arguments: {} });
      expect(JSON.stringify(pending.content)).toContain(request_id);

      // 6. …Petra approves it in HER inbox (a human, over REST)…
      const approve = await as("petra", {
        method: "POST",
        url: `/api/v1/approval-tasks/${outcome.routing.taskId}/approve`,
        payload: { comment: "within plant budget — approved for the bot" },
      });
      expect(approve.statusCode).toBe(200);

      // 7. …and the agent sees the green light.
      const finalStatus = await mcp.callTool({
        name: "get_decision_status",
        arguments: { request_id },
      });
      const finalBody = JSON.parse(
        (finalStatus.content as Array<{ text: string }>)[0]!.text
      ) as { state: string; decision: { outcome: string } };
      expect(finalBody.state).toBe("decided");
      expect(finalBody.decision.outcome).toBe("approved");

      // Every MCP call is on the audit trail.
      const events = await as("auditor", {
        method: "GET",
        url: "/api/v1/audit/events?type=mcp.call&limit=100",
      });
      const calls = events.json() as Array<{ payload: { tool: string } }>;
      expect(calls.length).toBeGreaterThanOrEqual(6);
      expect(new Set(calls.map((e) => e.payload.tool))).toContain("request_authority");

      await mcp.close();
    }, 90_000);
  });

  describe("self-service password change", () => {
    // A fresh human per test, so no test perturbs another's credential/sessions.
    let seq = 0;
    async function freshHuman(): Promise<{ id: string; email: string; password: string }> {
      seq += 1;
      const email = `pwuser${seq}@kolvarra.test`;
      const password = `pwuser${seq}-password-1234`;
      const created = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: { kind: "human", name: `PwUser${seq}`, email, password, roles: ["requester"] },
      });
      expect(created.statusCode).toBe(200);
      return { id: (created.json() as { id: string }).id, email, password };
    }
    async function loginCookie(email: string, password: string): Promise<string> {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password },
      });
      expect(r.statusCode).toBe(200);
      const sc = r.headers["set-cookie"];
      return (Array.isArray(sc) ? sc[0] : sc)!.split(";")[0]!;
    }

    it("changes it: old password fails, new works; other sessions die while the acting session and API keys survive", async () => {
      const u = await freshHuman();
      const acting = await loginCookie(u.email, u.password); // the device doing the change
      const other = await loginCookie(u.email, u.password); // a second, older session

      // An API key is a SEPARATE credential — it must survive a password change.
      const keyResp = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/api-keys",
        payload: { principalId: u.id, scopes: ["requests:read"] },
      });
      expect(keyResp.statusCode).toBe(200);
      const apiKey = (keyResp.json() as { token: string }).token;

      // Both sessions and the key are live before the change.
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: other } }))
          .statusCode
      ).toBe(200);

      const newPassword = "pw-brand-new-password-9876";
      const change = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { cookie: acting },
        payload: { currentPassword: u.password, newPassword },
      });
      expect(change.statusCode).toBe(200);
      expect((change.json() as { ok: boolean }).ok).toBe(true);

      // Old password no longer authenticates; the new one does.
      const oldLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: u.email, password: u.password },
      });
      expect(oldLogin.statusCode).toBe(401);
      const newLogin = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: u.email, password: newPassword },
      });
      expect(newLogin.statusCode).toBe(200);

      // Acting session survives; the other session is revoked.
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: acting } }))
          .statusCode
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: other } }))
          .statusCode
      ).toBe(401);

      // The API key is untouched by a password change.
      expect(
        (await app.inject({
          method: "GET",
          url: "/api/v1/requests",
          headers: { authorization: `Bearer ${apiKey}` },
        })).statusCode
      ).toBe(200);

      // The change is on the audit chain (and carries no password material).
      const events = await as("admin", {
        method: "GET",
        url: "/api/v1/audit/events?type=principal.password_changed&limit=100",
      });
      expect(events.statusCode).toBe(200);
      const rows = events.json() as Array<{ entity: { id: string }; payload: Record<string, unknown> }>;
      const mine = rows.find((e) => e.entity.id === u.id)!;
      expect(mine).toBeTruthy();
      expect(JSON.stringify(mine.payload)).not.toMatch(/password|pw-brand-new/i);
    });

    it("rejects a wrong current password (401) and leaves the credential unchanged", async () => {
      const u = await freshHuman();
      const cookie = await loginCookie(u.email, u.password);
      const bad = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { cookie },
        payload: { currentPassword: "not-the-password-1", newPassword: "pw-brand-new-password-9876" },
      });
      expect(bad.statusCode).toBe(401);
      // The original password still logs in — nothing changed.
      const still = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: u.email, password: u.password },
      });
      expect(still.statusCode).toBe(200);
    });

    it("rejects a too-short new password (422)", async () => {
      const u = await freshHuman();
      const cookie = await loginCookie(u.email, u.password);
      const short = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { cookie },
        payload: { currentPassword: u.password, newPassword: "short" },
      });
      expect(short.statusCode).toBe(422);
    });

    it("rejects an agent — agents have no password credential (409)", async () => {
      const resp = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { currentPassword: "irrelevant-1234", newPassword: "pw-brand-new-password-9876" },
      });
      expect(resp.statusCode).toBe(409);
    });

    it("rejects a SCIM/OIDC human with no local password (409)", async () => {
      // A provisioned human has password_hash = null and logs in via the IdP,
      // so we mint a session directly (there is no password to log in with).
      const created = await as("admin", {
        method: "POST",
        url: "/api/v1/admin/principals",
        payload: { kind: "human", name: "Provisioned", email: "provisioned@kolvarra.test", roles: ["requester"] },
      });
      expect(created.statusCode).toBe(200);
      const idpUserId = (created.json() as { id: string }).id;
      const { token, tokenSha256 } = newSessionToken();
      await pool.query(
        "INSERT INTO sessions (principal_id, token_sha256, expires_at) VALUES ($1, $2, $3)",
        [idpUserId, tokenSha256, new Date(Date.now() + SESSION_TTL_MS)]
      );
      const resp = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
        payload: { currentPassword: "irrelevant-1234", newPassword: "pw-brand-new-password-9876" },
      });
      expect(resp.statusCode).toBe(409);
      expect((resp.json() as { error: { message: string } }).error.message).toMatch(/identity provider/i);
    });
  });

  it("serves the OpenAPI document and matches the committed spec", async () => {
    const response = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(response.statusCode).toBe(200);
    const spec = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20);

    // Drift check: routes changed → regenerate with `pnpm openapi:write`.
    const committed = JSON.parse(
      readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../openapi.json"),
        "utf8"
      )
    ) as unknown;
    expect(spec).toEqual(committed);
  });
});
