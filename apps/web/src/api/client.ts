/**
 * Thin typed fetch wrapper. Every API call in the console goes through
 * here: same-origin, cookie-authenticated, and unwraps the server's
 * `{ error: { code, message, details? } }` envelope into ApiError.
 */

const BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ErrorEnvelope).error === "object"
  );
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let code = "internal";
  let message = `${res.status} ${res.statusText}`;
  let details: unknown;
  try {
    const body: unknown = await res.json();
    if (isErrorEnvelope(body)) {
      code = body.error.code;
      message = body.error.message;
      details = body.error.details;
    }
  } catch {
    // non-JSON error body — keep the status line
  }
  throw new ApiError(res.status, code, message, details);
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "include" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  return handle<T>(res);
}

export const api = {
  get: <T>(path: string): Promise<T> => json<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => json<T>("POST", path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => json<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => json<T>("PATCH", path, body),
  del: <T>(path: string): Promise<T> => json<T>("DELETE", path),
  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetch(BASE + path, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    return handle<T>(res);
  },
};
