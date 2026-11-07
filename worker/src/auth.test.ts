import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { normalizeTeamDomain, verifyAccessJwt } from "./auth";

const TEAM = "myteam.cloudflareaccess.com";
const AUD = "aud-tag-123";

let privateKey: CryptoKey;
let getKey: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  getKey = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "k1" }] });
});

const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(privateKey);

const verify = (t: string) => verifyAccessJwt(t, { teamDomain: TEAM, audience: AUD, getKey });

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns the email", async () => {
    expect(await verify(await sign({ email: "a@b.com" }))).toEqual({ email: "a@b.com" });
  });
  it("rejects the wrong audience (a different Access app)", async () => {
    await expect(verify(await sign({ email: "a@b.com" }, { aud: "other" }))).rejects.toThrow();
  });
  it("rejects the wrong issuer (a different team)", async () => {
    await expect(verify(await sign({ email: "a@b.com" }, { iss: "https://evil.example.com" }))).rejects.toThrow();
  });
  it("rejects an expired token", async () => {
    await expect(verify(await sign({ email: "a@b.com" }, { exp: "-1m" }))).rejects.toThrow();
  });
  it("rejects a token without an email", async () => {
    await expect(verify(await sign({}))).rejects.toThrow(/email/);
  });
  it("rejects a token signed by an unknown key", async () => {
    const other = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: "a@b.com" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verify(forged)).rejects.toThrow();
  });
  it("rejects garbage", async () => {
    await expect(verify("not.a.jwt")).rejects.toThrow();
  });
});

describe("normalizeTeamDomain", () => {
  it.each(["https://t.cloudflareaccess.com/", "t.cloudflareaccess.com", " http://t.cloudflareaccess.com "])("%s", (v) =>
    expect(normalizeTeamDomain(v)).toBe("t.cloudflareaccess.com"),
  );
});
