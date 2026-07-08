/**
 * Provider abstraction: one fetch POST per provider, no LLM SDKs.
 * Two endpoints don't warrant SDK dependency trees, and pinning the raw
 * request shape keeps promptHash meaningful.
 */

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface ExtractionProvider {
  id: string;
  model: string;
  complete(req: CompletionRequest): Promise<string>;
}

export function anthropicProvider(cfg: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): ExtractionProvider {
  return {
    id: "anthropic",
    model: cfg.model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch(`${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          temperature: 0,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      return (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
    },
  };
}

/** Covers vLLM, Ollama, LM Studio, Azure, and most self-hosted gateways. */
export function openaiCompatProvider(cfg: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): ExtractionProvider {
  return {
    id: "openai-compatible",
    model: cfg.model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: maxTokens,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai-compatible ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? "";
    },
  };
}

/**
 * The stub provider extracts NOTHING: every declared fact resolves NOT_FOUND
 * and a human enters values in fact review. For CI, demos, and deployments
 * that want a purely manual pipeline — never a substitute for a real model.
 */
export function stubProvider(): ExtractionProvider {
  return {
    id: "stub",
    model: "stub-not-found-v1",
    async complete() {
      return JSON.stringify({ facts: [] });
    },
  };
}

/** Provider from DDAS_EXTRACTION_* env (see .env.example). */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): ExtractionProvider {
  const kind = env["DDAS_EXTRACTION_PROVIDER"] ?? "anthropic";
  if (kind === "stub") return stubProvider();
  const model = env["DDAS_EXTRACTION_MODEL"];
  if (!model) throw new Error("DDAS_EXTRACTION_MODEL is not set");
  if (kind === "anthropic") {
    const apiKey = env["DDAS_EXTRACTION_API_KEY"];
    if (!apiKey) throw new Error("DDAS_EXTRACTION_API_KEY is not set");
    return anthropicProvider({
      apiKey,
      model,
      ...(env["DDAS_EXTRACTION_BASE_URL"] ? { baseUrl: env["DDAS_EXTRACTION_BASE_URL"] } : {}),
    });
  }
  if (kind === "openai-compatible") {
    const baseUrl = env["DDAS_EXTRACTION_BASE_URL"];
    if (!baseUrl) throw new Error("DDAS_EXTRACTION_BASE_URL is not set for openai-compatible");
    return openaiCompatProvider({
      baseUrl,
      model,
      ...(env["DDAS_EXTRACTION_API_KEY"] ? { apiKey: env["DDAS_EXTRACTION_API_KEY"] } : {}),
    });
  }
  throw new Error(`unknown DDAS_EXTRACTION_PROVIDER '${kind}'`);
}
