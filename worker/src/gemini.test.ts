import { describe, expect, it, vi } from "vitest";
import { GeminiError, generateJson } from "./gemini";

const ok = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const status = (s: number) => new Response("{}", { status: s });

function setup(responses: (Response | Error)[]) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url).match(/models\/([^:]+):/)![1]);
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const opts = { apiKey: "k", models: ["m1", "m2"], fetchImpl, sleep: async () => {}, attemptsPerModel: 2 };
  return { calls, opts };
}

describe("generateJson", () => {
  it("returns parsed JSON and the model used", async () => {
    const { opts, calls } = setup([ok({ a: 1 })]);
    expect(await generateJson(opts, {})).toEqual({ data: { a: 1 }, model: "m1" });
    expect(calls).toEqual(["m1"]);
  });

  it("retries a busy model, then falls back to the next", async () => {
    const { opts, calls } = setup([status(503), status(503), ok({ a: 2 })]);
    expect(await generateJson(opts, {})).toEqual({ data: { a: 2 }, model: "m2" });
    expect(calls).toEqual(["m1", "m1", "m2"]);
  });

  it("retries after a timeout / network error", async () => {
    const { opts } = setup([new Error("boom"), ok({ a: 3 })]);
    expect((await generateJson(opts, {})).data).toEqual({ a: 3 });
  });

  it("retries an empty answer", async () => {
    const { opts } = setup([new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] })), ok({ a: 4 })]);
    expect((await generateJson(opts, {})).data).toEqual({ a: 4 });
  });

  it("does not retry or fall back on a client error such as an invalid key", async () => {
    const { opts, calls } = setup([status(403)]);
    await expect(generateJson(opts, {})).rejects.toMatchObject({ name: "GeminiError", status: 403 });
    expect(calls).toEqual(["m1"]);
  });

  it("skips a retired model (404) and tries the next", async () => {
    const { opts, calls } = setup([status(404), ok({ a: 5 })]);
    expect((await generateJson(opts, {})).model).toBe("m2");
    expect(calls).toEqual(["m1", "m2"]);
  });

  it("does not retry a rate-limited (429) model: it moves straight to the next", async () => {
    const { opts, calls } = setup([status(429), ok({ a: 6 })]);
    expect((await generateJson(opts, {})).model).toBe("m2");
    expect(calls).toEqual(["m1", "m2"]);
  });

  it("reports busy when every model is overloaded or rate limited", async () => {
    const { opts } = setup([status(503), status(503), status(429)]);
    const err = await generateJson(opts, {}).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.busy).toBe(true);
  });

  it("stops at the overall deadline", async () => {
    let t = 0;
    const { opts, calls } = setup([status(503), status(503), status(503), status(503)]);
    const err = await generateJson({ ...opts, totalDeadlineMs: 1000, now: () => (t += 600) }, {}).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(calls.length).toBeLessThan(4);
  });

  it("refuses to run without a key", async () => {
    await expect(generateJson({ apiKey: "", models: ["m"] }, {})).rejects.toBeInstanceOf(GeminiError);
  });
});
