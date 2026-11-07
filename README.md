# 單字庫 Vocab

Photograph an English test paper → the app reads it → pick the words you don't know → each gets an English and a Traditional Chinese definition and goes into your word bank, which you can browse from your phone or computer.

```
phone/computer (React app, behind Cloudflare Access login)
        │
        ▼
Cloudflare Worker ── POST /api/scan  → Gemini (reads the photo: options, circled/underlined words, handwritten glosses)
        │          └─ POST /api/words → Gemini (EN + 中文 definitions) → D1
        ▼
Cloudflare D1 (the word bank lives here, not in the browser)
```

* **Rotate buttons.** The model reads a photo reliably only when the text is upright (on the sample paper, a sideways photo paired *every* option with the wrong question; upright it was 17/17). The scan screen shows a preview with rotate left/right; rotate until it reads normally.
* **Preselection.** Every option, circled/underlined word and word with a handwritten gloss is preselected; uncheck what you already know. Words already in the bank are greyed out. The student's handwritten gloss is saved as "my note".
* **Browser storage.** Only the Cloudflare Access session cookie. Words are stored server-side.

## Develop locally

```bash
npm install
cp .dev.vars.example .dev.vars        # then put your Gemini key in it (file is gitignored)
npm run db:migrate:local
npm run dev                            # app on http://localhost:5173, API on :8787
```

`DEV_AUTH_BYPASS=1` skips the login, but only for requests to `localhost` / `127.0.0.1`.

```bash
npm test          # unit tests
npm run typecheck
npm run scan-test -- path/to/photo.jpg   # try the scan prompt on its own (needs GEMINI_API_KEY in the environment)
```

## Deploy (Cloudflare, free tier)

1. **Database**
   ```bash
   npx wrangler d1 create english-vocab        # paste the printed database_id into wrangler.jsonc
   npm run db:migrate:remote
   ```
2. **Gemini key** (use an AI Studio key; Vertex AI needs billing):
   ```bash
   npx wrangler secret put GEMINI_API_KEY
   ```
3. **Domain**: uncomment `routes` in `wrangler.jsonc` with a hostname on a domain in your Cloudflare account.
4. **Login (Cloudflare Access)**: Zero Trust → Access → Applications → *Add an application* → Self-hosted → the same hostname → a policy that allows only your/your friend's email. Then copy into `wrangler.jsonc`:
   * `ACCESS_TEAM_DOMAIN`: `<your-team>.cloudflareaccess.com`
   * `ACCESS_AUD`: the application's *Audience (AUD) tag*
5. `npm run deploy`

The Worker **verifies the Access token itself** and refuses every `/api` request while `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are empty, so the `*.workers.dev` URL (which Access does not cover) never serves data.

## Gemini free-tier limits

The free tier has per-model daily/per-minute quotas and frequent 503 "high demand" responses. The API tries the models in `GEMINI_MODELS` in order (a 503 is retried once, a 429 moves straight to the next model) and tells the user to wait a minute if all are busy. A scan is one request; saving words is one request per 25 words. If a model is retired or exhausted, edit `GEMINI_MODELS` in `wrangler.jsonc`. All models in the list must support `thinkingConfig.thinkingLevel` (Gemini 3.x).
