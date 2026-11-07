import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireAuth } from "./auth";
import type { Env } from "./env";

function appWith(vars: Partial<Env>) {
  const app = new Hono<{ Bindings: Env; Variables: { email: string } }>();
  app.use("*", requireAuth);
  app.get("/", (c) => c.json({ email: c.get("email") }));
  const env = { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "", ...vars } as Env;
  return (url: string, headers: Record<string, string> = {}) => app.request(url, { headers }, env);
}

const PROD = "https://vocab.example.com/";
const configured = { ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123" };

describe("requireAuth", () => {
  it("fails closed (503) when Access is not configured", async () => {
    expect((await appWith({})(PROD)).status).toBe(503);
  });
  it("fails closed even if a token header is present but Access is not configured", async () => {
    expect((await appWith({})(PROD, { "Cf-Access-Jwt-Assertion": "x.y.z" })).status).toBe(503);
  });
  it("rejects a request with no token (401)", async () => {
    expect((await appWith(configured)(PROD)).status).toBe(401);
  });
  it("rejects a malformed token (401)", async () => {
    expect((await appWith(configured)(PROD, { "Cf-Access-Jwt-Assertion": "not.a.jwt" })).status).toBe(401);
  });
  it("dev bypass works on localhost", async () => {
    const res = await appWith({ DEV_AUTH_BYPASS: "1" })("http://localhost:8787/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "dev@localhost" });
  });
  it("dev bypass is ignored on a real hostname, even if the flag leaks into production", async () => {
    expect((await appWith({ DEV_AUTH_BYPASS: "1" })(PROD)).status).toBe(503);
    expect((await appWith({ DEV_AUTH_BYPASS: "1", ...configured })(PROD)).status).toBe(401);
  });
  it("dev bypass needs the exact flag value", async () => {
    expect((await appWith({ DEV_AUTH_BYPASS: "true" })("http://localhost:8787/")).status).toBe(503);
  });
});
