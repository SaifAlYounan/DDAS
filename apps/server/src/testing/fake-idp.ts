/**
 * In-process fake OIDC IdP for tests (extracted from oidc.e2e.test.ts so the
 * SCIM suite can prove SCIM↔OIDC dedup): discovery, authorization redirect,
 * PKCE-verified token exchange with a jose-signed RS256 id_token.
 * Test-only — excluded from the build (tsconfig.build.json).
 */
import { createHash } from "node:crypto";
import http from "node:http";
import * as jose from "jose";

export interface FakeIdp {
  issuer: string;
  close: () => Promise<void>;
  /** claims returned in the next id_token */
  nextUser: { sub: string; email: string; name: string; emailVerified?: boolean };
}

export async function startFakeIdp(clientId: string): Promise<FakeIdp> {
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = await jose.exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const pendingCodes = new Map<string, { challenge: string; nonce: string | null }>();
  const state: FakeIdp = {
    issuer: "",
    close: async () => undefined,
    nextUser: {
      sub: "sso-user-1",
      email: "sso.user@kolvarra.test",
      name: "SSO User",
      emailVerified: true,
    },
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url!, state.issuer);
    const send = (status: number, body: unknown) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer: state.issuer,
        authorization_endpoint: `${state.issuer}/authorize`,
        token_endpoint: `${state.issuer}/token`,
        jwks_uri: `${state.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") {
      return send(200, { keys: [jwk] });
    }
    if (url.pathname === "/authorize") {
      // "The user authenticates" — immediately bounce back with a code.
      const code = `code-${Math.random().toString(36).slice(2)}`;
      pendingCodes.set(code, {
        challenge: url.searchParams.get("code_challenge") ?? "",
        nonce: url.searchParams.get("nonce"),
      });
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
      response.statusCode = 302;
      response.setHeader("location", redirect.href);
      return response.end();
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        void (async () => {
          const params = new URLSearchParams(body);
          const code = params.get("code") ?? "";
          const verifier = params.get("code_verifier") ?? "";
          const pending = pendingCodes.get(code);
          const challenge = createHash("sha256").update(verifier).digest("base64url");
          if (!pending || pending.challenge !== challenge) {
            return send(400, { error: "invalid_grant" });
          }
          pendingCodes.delete(code);
          const idToken = await new jose.SignJWT({
            email: state.nextUser.email,
            email_verified: state.nextUser.emailVerified ?? false,
            name: state.nextUser.name,
            // Echo the flow nonce so the client's expectedNonce check passes.
            ...(pending.nonce ? { nonce: pending.nonce } : {}),
          })
            .setProtectedHeader({ alg: "RS256", kid: "test-key" })
            .setIssuer(state.issuer)
            .setSubject(state.nextUser.sub)
            .setAudience(clientId)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
          send(200, {
            access_token: "fake-access-token",
            token_type: "Bearer",
            expires_in: 300,
            id_token: idToken,
          });
        })();
      });
      return;
    }
    send(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  state.issuer = `http://127.0.0.1:${port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}
