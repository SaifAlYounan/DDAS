/**
 * Browser smoke over the REAL stack: the built SPA served by the real server
 * against a scratch Postgres, extraction stubbed to NOT_FOUND so a human
 * enters facts in fact review — the manual-entry path, end to end:
 * login → submit → fact review (MANUAL entries) → confirm/classify →
 * approver inbox → decision. Org/policy/users are seeded over the API.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:3210";
const CORPUS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/testkit/corpus/kolvarra"
);

interface LabeledFact {
  id: string;
  status: "FOUND" | "NOT_FOUND";
  value?: unknown;
  unit?: string;
}

const flagship = JSON.parse(
  readFileSync(path.join(CORPUS, "cases/vendor-msa-high-value.json"), "utf8")
) as { documents: Array<{ path: string }>; labeled_facts: LabeledFact[] };
const policyYaml = readFileSync(path.join(CORPUS, "policy/kolvarra-risk.v1.yaml"), "utf8");

/** Tiny cookie-carrying API client for seeding. */
class Api {
  private cookie = "";
  async login(email: string, password: string): Promise<void> {
    const response = await fetch(`${BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error(`login ${email}: ${response.status}`);
    this.cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  }
  async call<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE}/api/v1${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: this.cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}

test.beforeAll(async () => {
  const api = new Api();
  await api.login("admin@smoke.test", "smoke-password-123");
  const ruben = await api.call<{ id: string }>("POST", "/admin/principals", {
    kind: "human",
    name: "Ruben",
    email: "ruben@smoke.test",
    password: "ruben-password-123",
    roles: ["requester"],
  });
  const petra = await api.call<{ id: string }>("POST", "/admin/principals", {
    kind: "human",
    name: "Petra",
    email: "petra@smoke.test",
    password: "petra-password-123",
    roles: ["approver"],
  });
  const unit = await api.call<{ id: string }>("POST", "/org/units", {
    name: "Kolvarra Industrial Systems B.V.",
  });
  for (const [title, tier, holder] of [
    ["Team Lead", 1, ruben.id],
    ["Plant Director", 2, petra.id],
  ] as const) {
    const position = await api.call<{ id: string }>("POST", "/org/positions", {
      orgUnitId: unit.id,
      title,
      authorityTier: tier,
    });
    await api.call("POST", "/org/position-assignments", {
      positionId: position.id,
      principalId: holder,
      validFrom: "2020-01-01T00:00:00.000Z",
    });
  }
  const version = await api.call<{ id: string }>("POST", "/policies/kolvarra-risk/versions", {
    sourceYaml: policyYaml,
  });
  await api.call("POST", `/policy-versions/${version.id}/activate`, {
    overrideReason: "smoke bootstrap — nothing to simulate yet",
  });
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/login/);
}

test("submit → fact review → classify → inbox decision, in the browser", async ({
  page,
  browser,
}) => {
  // --- Ruben submits a request with the flagship contract document ---
  await login(page, "ruben@smoke.test", "ruben-password-123");
  await page.goto("/requests/new");
  await page.getByLabel("Title").fill("Halcyon MSA renewal (smoke)");
  await page.getByLabel("Policy").selectOption({ label: "kolvarra-risk (v1)" });
  const docPath = path.join(CORPUS, flagship.documents[0]!.path);
  await page.locator('input[type="file"]').setInputFiles(docPath);
  await page.getByRole("button", { name: /submit request/i }).click();

  // Stub extraction lands everything NOT_FOUND → facts_review.
  await expect(page.getByText(/facts.review|fact review/i).first()).toBeVisible({
    timeout: 30_000,
  });

  // --- Manual fact entry: every labeled FOUND fact entered as MANUAL ---
  for (const fact of flagship.labeled_facts) {
    if (fact.status !== "FOUND") continue;
    const row = page.getByRole("listitem").filter({ hasText: fact.id }).first();
    await row.getByRole("button", { name: /edit/i }).click();
    await page.getByLabel("Status").selectOption("MANUAL");
    await page.getByLabel("Value").fill(String(fact.value));
    if (fact.unit) await page.getByLabel(/unit/i).fill(fact.unit);
    await expect(page.getByText(/recorded as/i)).toBeVisible(); // the attestation notice
    await page.getByRole("button", { name: /^save/i }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: fact.id }).first()
    ).toContainText("MANUAL");
  }

  // --- Confirm & classify (freeze warning dialog) ---
  await page.getByRole("button", { name: /confirm facts/i }).click();
  await page.getByRole("button", { name: /confirm|freeze|classify/i }).last().click();

  // Tier 2 → pending approval; the derivation view shows the binding category.
  await expect(page.getByText(/pending.approval/i).first()).toBeVisible({ timeout: 15_000 });

  // --- Petra decides it from her inbox in a second browser context ---
  const petraContext = await browser.newContext({ baseURL: BASE });
  const petraPage = await petraContext.newPage();
  await login(petraPage, "petra@smoke.test", "petra-password-123");
  await petraPage.goto("/inbox");
  await petraPage.getByText("Halcyon MSA renewal (smoke)").first().click();
  await expect(petraPage.getByText(/final tier|tier 2|plant director/i).first()).toBeVisible();
  await petraPage.getByRole("button", { name: /^approve/i }).click();
  await expect(petraPage.getByText(/approved|decided|empty|no open/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await petraContext.close();

  // --- Ruben sees the decision ---
  await page.reload();
  await expect(page.getByText(/decided/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/approved/i).first()).toBeVisible();
});
