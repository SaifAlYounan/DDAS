/**
 * End-to-end over HTTP: the whole Phase-1 headless pipeline, now behind the
 * API — submit → extract (fake provider) → facts_review → confirm → classify
 * → route → approve → decide, plus replay, audit verify, and simulation.
 * The Kolvarra golden corpus is replayed case-by-case: HTTP parity with the
 * engine's own corpus suite.
 */
import { mkdtempSync, readFileSync } from "node:fs";
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

  async function as(user: string, opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) {
    const response = await app.inject({
      method: opts.method as "GET",
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as string } : {}),
      headers: { ...(opts.headers ?? {}), cookie: cookies[user]! },
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
      // Agent submission arrives via API key + MCP in Phase 3; Phase 2 seeds
      // the agent's request directly and runs the same pipeline behind it.
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO requests (requester_id, policy_version_id, title, state)
         VALUES ($1, $2, $3, 'extracting') RETURNING id`,
        [principalIds["agent"], policyVersionId, c.case_id]
      );
      requestId = inserted.rows[0]!.id;
      for (const [docIndex, doc] of caseDocs(c).entries()) {
        await pool.query(
          `INSERT INTO documents (request_id, doc_index, name, sha256, content_type, size_bytes, extracted_text)
           VALUES ($1, $2, $3, $4, 'text/plain', $5, $6)`,
          [requestId, docIndex, doc.filename, c.documents[docIndex]!.sha256, doc.content.length, doc.content]
        );
      }
      await app.ctx.boss!.send("extraction.run", { requestId }, { retryLimit: 2 });
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
