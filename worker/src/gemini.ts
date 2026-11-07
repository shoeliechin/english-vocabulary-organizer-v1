// Minimal Gemini REST client with the retry/fallback the free tier needs:
// it regularly answers 503 ("high demand") or 429 (rate limit) for a model.

export class GeminiError extends Error {
  constructor(
    message: string,
    /** HTTP status of the last failure, if any. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
  /** True when the failure is capacity/rate related and waiting may help. */
  get busy(): boolean {
    return this.status === 429 || this.status === 503 || this.status === undefined;
  }
}

export interface GeminiOptions {
  apiKey: string;
  /** Tried in order. */
  models: string[];
  attemptsPerModel?: number;
  perRequestTimeoutMs?: number;
  /** Give up on the whole call after this long, across all retries. */
  totalDeadlineMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface GeminiResult<T> {
  data: T;
  model: string;
}

export async function generateJson<T>(opts: GeminiOptions, body: unknown): Promise<GeminiResult<T>> {
  const {
    apiKey,
    models,
    attemptsPerModel = 2,
    perRequestTimeoutMs = 45_000,
    totalDeadlineMs = 100_000,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
  } = opts;

  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not configured");
  const deadline = now() + totalDeadlineMs;
  let lastStatus: number | undefined;
  let lastDetail = "no response";

  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      if (now() >= deadline) throw new GeminiError(`Gemini did not answer in time (${lastDetail})`, lastStatus);

      let res: Response;
      try {
        res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(perRequestTimeoutMs, Math.max(1_000, deadline - now()))),
        });
      } catch (err) {
        lastStatus = undefined;
        lastDetail = `${model}: ${err instanceof Error ? err.name : "network error"}`;
        continue; // timeout / network: retry, then next model
      }

      if (res.ok) {
        const json = (await res.json()) as GeminiResponse;
        const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (!text) {
          lastStatus = undefined;
          lastDetail = `${model}: empty response (${json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "unknown"})`;
          continue;
        }
        try {
          return { data: JSON.parse(text) as T, model };
        } catch {
          lastStatus = undefined;
          lastDetail = `${model}: invalid JSON`;
          continue;
        }
      }

      lastStatus = res.status;
      lastDetail = `${model}: HTTP ${res.status}`;
      // 429 means this model's quota/rate limit is used up. Retrying the same
      // model only burns more of a free-tier quota that is already low, so go
      // straight to the next model.
      if (res.status === 429) break;
      if (!RETRYABLE.has(res.status)) {
        // 400/401/403/404: retrying the same request cannot help. A 404 can mean
        // the model was retired, so still let the next model have a go.
        if (res.status === 404) break;
        throw new GeminiError(`Gemini rejected the request (${lastDetail})`, res.status);
      }
      await sleep(attempt * 2_000);
    }
  }
  throw new GeminiError(`Gemini is unavailable right now (${lastDetail})`, lastStatus);
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}
