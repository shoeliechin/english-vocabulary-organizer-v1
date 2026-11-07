export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Secret: `wrangler secret put GEMINI_API_KEY` (or .dev.vars locally). */
  GEMINI_API_KEY: string;
  GEMINI_MODELS: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Local development only (.dev.vars). Ignored unless the request is to localhost. */
  DEV_AUTH_BYPASS?: string;
}
