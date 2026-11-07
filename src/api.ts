import type { SaveItem, SaveResponse, ScanResponse, Status, Word } from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: json !== undefined ? { "content-type": "application/json" } : undefined,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    // Offline, or Cloudflare Access redirected to its login page after the session expired.
    throw new ApiError("Could not reach the server. Check your connection, or reload the page to sign in again.", 0, true);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, Boolean(body?.retryable));
  }
  return body as T;
}

export const api = {
  me: () => request<{ email: string }>("/api/me"),
  scan: (image: string, mimeType: string) => request<ScanResponse>("/api/scan", { method: "POST", json: { image, mimeType } }),
  saveWords: (items: SaveItem[]) => request<SaveResponse>("/api/words", { method: "POST", json: { items } }),
  listWords: (q: string, status: Status | "") => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (status) p.set("status", status);
    return request<{ words: Word[] }>(`/api/words?${p}`);
  },
  updateWord: (id: number, patch: { status?: Status; user_note?: string }) =>
    request<{ word: Word }>(`/api/words/${id}`, { method: "PATCH", json: patch }),
  deleteWord: (id: number) => request<{ ok: true }>(`/api/words/${id}`, { method: "DELETE" }),
};
