# Hermes ↔ Leadiya

Hermes is **not** vendored in this repo. Install it per [Nous Hermes Agent](https://hermes-agent.nousresearch.com/) (`hermes` CLI or upstream install script).

## What to configure in Hermes

| Variable | Example | Purpose |
|----------|---------|---------|
| `LEADIYA_API_BASE_URL` | `http://127.0.0.1:3041` | Base URL for HTTP tools (no trailing slash) |
| `LEADIYA_AGENT_SERVICE_KEY` | same as API `.env` | Sent as `X-Leadiya-Service-Key` |

Match the port to your API (`dev-ports.json` → `localCliApiPort`, or `3001` in Docker Compose).

## Next steps

1. Read [`docs/HERMES_INTEGRATION.md`](../docs/HERMES_INTEGRATION.md).
2. From repo root: `npm run setup:agent-bridge` — generates `LEADIYA_AGENT_SERVICE_KEY` in `.env` (if missing) and writes gitignored `hermes/.env` for Hermes (`LEADIYA_API_BASE_URL` + same key). Restart the API after changing `.env`.
3. From repo root: `npm run verify:agent-api` (with API + Redis running). This checks CRM (`GET /api/companies`) and outreach (`GET /api/outreach/business`, `GET /api/outreach/sequences`) with `X-Leadiya-Service-Key`.
4. Optional WhatsApp path: set `WHATSAPP_BAILEYS_ENABLED=true`, run workers so Baileys is connected, put a test lead UUID in `LEADIYA_VERIFY_LEAD_ID` (and `LEADIYA_VERIFY_PHONE_OVERRIDE` if needed), then `LEADIYA_VERIFY_SEND=1` to queue a real send — same headers Hermes will use.
5. In Hermes, load env from `hermes/.env` or export the same variables; add HTTP tools using paths from [`docs/hermes-tools.manifest.json`](../docs/hermes-tools.manifest.json).

## Prompt hint (system / operator)

Keep Leadiya authoritative: **every** lead change, log line, or send must go through the documented API. Do not claim actions that were not returned by the API response.
