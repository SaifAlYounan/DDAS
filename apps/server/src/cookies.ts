/**
 * Cookie security helpers (authn-C2).
 *
 * A session/flow cookie must carry `Secure` whenever the connection is HTTPS.
 * Behind a TLS-terminating proxy Fastify only knows the request is HTTPS when
 * `trustProxy` is on and it honors X-Forwarded-Proto — so we combine that
 * signal with an explicit production override, so a missing proxy header can
 * never silently strip `Secure` in production.
 */
import type { FastifyRequest } from "fastify";

export function secureCookie(request: FastifyRequest): boolean {
  return request.protocol === "https" || process.env["NODE_ENV"] === "production";
}

/** How to read Fastify's `trustProxy` option from TRUST_PROXY. */
export function parseTrustProxy(value: string): boolean | string {
  if (value === "true") return true;
  if (value === "false") return false;
  return value; // a comma-separated IP/CIDR allowlist
}
