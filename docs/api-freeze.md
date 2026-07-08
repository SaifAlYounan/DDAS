# /api/v1 freeze checklist

`/api/v1` is frozen additive-only from v2.0.0. "Additive" means: new paths,
new OPTIONAL request fields, new response fields. Anything else — removing or
renaming a field, changing a type, tightening validation on an existing field,
changing an error code's meaning — is a breaking change and needs `/api/v2`.

## What the freeze covers

1. **REST paths and schemas** — the committed [`apps/server/openapi.json`](../apps/server/openapi.json)
   is the contract. CI fails when routes drift from the committed file
   (`pnpm --filter @ddas/server openapi:write` to regenerate deliberately).
2. **The error envelope** — `{ error: { code, message, details? } }` with the
   closed code union in `apps/server/src/errors.ts`. New codes are additive;
   repurposing existing codes is breaking.
3. **Webhook payloads** — `{ deliveryId, event: { seq, occurredAt, type,
   actor, entity, payload, eventHash } }`, the `X-DDAS-Signature`
   `t=<ts>,v1=<hmac-sha256(t + "." + body)>` scheme, and the 300s replay
   window. Audit event TYPES are additive-only (the closed union in
   `packages/audit/src/events.ts`); payload fields within an event type are
   additive-only too.
4. **MCP tools** — tool names and input schemas in
   `apps/server/src/routes/mcp.ts`. New tools and new optional params are
   fine; renaming or removing breaks agents in the field.
5. **The derivation object** — versioned by `engineVersion`; replay
   compatibility is governed by the engine's own invariants (see the ADRs),
   not this freeze.

## Release checklist

- [ ] `pnpm test` green, including the OpenAPI drift check.
- [ ] No removed/renamed paths, fields, enum members, or error codes vs the
      previous release's `openapi.json` (diff the two files).
- [ ] New audit event types appended to the union, never renamed.
- [ ] Webhook payload changes are new-fields-only.
- [ ] MCP tool schema changes are new-optional-params only.
- [ ] Migration path: `ddas migrate` from the previous release boots clean.
- [ ] `ddas backup create` → `restore` round-trips with chain verification.
