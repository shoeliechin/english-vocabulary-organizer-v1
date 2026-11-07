import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

// Cloudflare Access signs a JWT for every request that passes its login and
// sends it in the Cf-Access-Jwt-Assertion header. Access only protects the
// hostnames it is attached to (e.g. NOT the *.workers.dev URL), so the Worker
// verifies the JWT itself instead of trusting that a request got through.

export function normalizeTeamDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; audience: string; getKey: JWTVerifyGetKey },
): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, opts.getKey, {
    issuer: `https://${normalizeTeamDomain(opts.teamDomain)}`,
    audience: opts.audience,
  });
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email) throw new Error("Access token has no email claim");
  return { email };
}

const keySets = new Map<string, JWTVerifyGetKey>();
function remoteKeys(teamDomain: string): JWTVerifyGetKey {
  const domain = normalizeTeamDomain(teamDomain);
  let keys = keySets.get(domain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
    keySets.set(domain, keys);
  }
  return keys;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: { email: string } }> = async (c, next) => {
  // Local development only: needs BOTH the .dev.vars flag and a localhost URL,
  // so a leaked flag cannot open up the deployed site.
  if (c.env.DEV_AUTH_BYPASS === "1" && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
    c.set("email", "dev@localhost");
    return next();
  }

  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const audience = c.env.ACCESS_AUD;
  if (!teamDomain || !audience) {
    // Fail closed: never serve data while auth is unconfigured.
    return c.json({ error: "Server login is not configured yet (ACCESS_TEAM_DOMAIN / ACCESS_AUD)." }, 503);
  }

  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return c.json({ error: "Not signed in" }, 401);

  try {
    const { email } = await verifyAccessJwt(token, { teamDomain, audience, getKey: remoteKeys(teamDomain) });
    c.set("email", email);
  } catch {
    return c.json({ error: "Invalid login session" }, 401);
  }
  return next();
};
