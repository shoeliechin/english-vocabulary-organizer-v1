import { Hono } from "hono";
import { MAX_SAVE_ITEMS, STATUSES } from "../../shared/types";
import type { SaveItem, SaveResponse, ScanResponse, Status } from "../../shared/types";
import { requireAuth } from "./auth";
import { deleteWord, existingLemmas, insertWords, listWords, updateWord } from "./db";
import { buildDefineRequest, parseDefinitions } from "./define";
import type { Definition } from "./define";
import type { Env } from "./env";
import { GeminiError, generateJson } from "./gemini";
import type { GeminiOptions } from "./gemini";
import { buildScanRequest, flattenScan, normalizeLemma } from "./scan";
import type { RawScan } from "./scan";

type App = { Bindings: Env; Variables: { email: string } };
const app = new Hono<App>();

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BASE64 = 7_000_000; // ~5 MB of image; the app sends ~0.5 MB
const DEFINE_CHUNK = 25; // words per Gemini call

const gemini = (env: Env): Pick<GeminiOptions, "apiKey" | "models"> => ({
  apiKey: env.GEMINI_API_KEY,
  models: env.GEMINI_MODELS.split(",").map((m) => m.trim()).filter(Boolean),
});

app.use("/api/*", requireAuth);

// Cross-site pages cannot send application/json without a CORS preflight,
// which this API never grants. Requiring it blocks cross-site form posts.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "DELETE") {
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      return c.json({ error: "Expected application/json" }, 415);
    }
  }
  return next();
});

app.onError((err, c) => {
  if (err instanceof GeminiError) {
    console.error("gemini:", err.message);
    return c.json(
      {
        error: err.busy
          ? "The AI service is busy right now. Wait a minute and try again."
          : "The AI service could not process this request.",
        retryable: err.busy,
      },
      err.busy ? 503 : 502,
    );
  }
  console.error("unhandled:", err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

app.get("/api/me", (c) => c.json({ email: c.get("email") }));

// ---- Scan: photo -> candidate words ---------------------------------------

app.post("/api/scan", async (c) => {
  const body = await c.req.json<{ image?: unknown; mimeType?: unknown }>().catch(() => null);
  const image = typeof body?.image === "string" ? body.image : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  if (!image || !IMAGE_TYPES.has(mimeType)) return c.json({ error: "Send a JPEG, PNG or WebP image." }, 400);
  if (image.length > MAX_IMAGE_BASE64) return c.json({ error: "Image is too large." }, 413);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(image)) return c.json({ error: "Image must be base64 encoded." }, 400);

  const { data, model } = await generateJson<RawScan>(gemini(c.env), buildScanRequest(image, mimeType));
  const flat = flattenScan(data);
  const saved = await existingLemmas(c.env.DB, flat.map((w) => w.lemma));

  const res: ScanResponse = {
    candidates: flat.map((w) => ({ ...w, saved: saved.has(w.lemma) })),
    questionCount: data.questions?.length ?? 0,
    model,
  };
  return c.json(res);
});

// ---- Words -----------------------------------------------------------------

app.get("/api/words", async (c) => {
  const status = c.req.query("status");
  if (status && !STATUSES.includes(status as Status)) return c.json({ error: "Unknown status" }, 400);
  const words = await listWords(c.env.DB, (c.req.query("q") ?? "").trim().slice(0, 100), (status as Status) || null);
  return c.json({ words });
});

/** Define the selected candidates with Gemini, then save them. */
app.post("/api/words", async (c) => {
  const body = await c.req.json<{ items?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.items)) return c.json({ error: "Expected { items: [...] }" }, 400);
  if (body.items.length > MAX_SAVE_ITEMS) return c.json({ error: `At most ${MAX_SAVE_ITEMS} words per save.` }, 400);

  // Normalize + dedupe; ignore anything that is not a plausible word.
  const items = new Map<string, SaveItem>();
  for (const raw of body.items as Partial<Record<keyof SaveItem, unknown>>[]) {
    const lemma = normalizeLemma(raw?.lemma);
    if (!lemma || items.has(lemma)) continue;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    items.set(lemma, { lemma, sentence: str(raw.sentence, 300), source: str(raw.source, 40), note: str(raw.note, 200) });
  }
  if (items.size === 0) return c.json({ error: "No valid words to save." }, 400);

  const already = await existingLemmas(c.env.DB, [...items.keys()]);
  const todo = [...items.values()].filter((i) => !already.has(i.lemma));

  const defs = new Map<string, Definition>();
  let lastError: unknown;
  for (let i = 0; i < todo.length; i += DEFINE_CHUNK) {
    const part = todo.slice(i, i + DEFINE_CHUNK);
    try {
      const { data } = await generateJson<{ definitions?: Partial<Definition>[] }>(gemini(c.env), buildDefineRequest(part));
      for (const [k, v] of parseDefinitions(data, part.map((p) => p.lemma))) defs.set(k, v);
    } catch (err) {
      // The remaining chunks would very likely hit the same limit: stop, keep
      // what we have, and report the rest as failed so the user can retry.
      lastError = err;
      break;
    }
  }
  if (todo.length > 0 && defs.size === 0 && lastError) throw lastError;

  const rows = todo.flatMap((i) => {
    const d = defs.get(i.lemma);
    return d ? [{ ...d, source: i.source, user_note: i.note }] : [];
  });
  const saved = await insertWords(c.env.DB, rows);

  const res: SaveResponse = {
    saved,
    skipped: [...already],
    failed: todo.filter((i) => !defs.has(i.lemma)).map((i) => i.lemma),
  };
  return c.json(res);
});

const parseId = (raw: string) => (/^\d{1,12}$/.test(raw) ? Number(raw) : null);

app.patch("/api/words/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const body = await c.req.json<{ status?: unknown; user_note?: unknown }>().catch(() => null);
  if (id === null || !body) return c.json({ error: "Bad request" }, 400);

  const patch: { status?: Status; user_note?: string } = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as Status)) return c.json({ error: "Unknown status" }, 400);
    patch.status = body.status as Status;
  }
  if (body.user_note !== undefined) {
    if (typeof body.user_note !== "string") return c.json({ error: "user_note must be text" }, 400);
    patch.user_note = body.user_note.trim().slice(0, 500);
  }
  const word = await updateWord(c.env.DB, id, patch);
  return word ? c.json({ word }) : c.json({ error: "Not found" }, 404);
});

app.delete("/api/words/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Bad request" }, 400);
  return (await deleteWord(c.env.DB, id)) ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default app;
