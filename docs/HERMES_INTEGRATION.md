# Hermes (agent) + Leadiya — integration plan

This document fixes the product direction: **Nous [Hermes Agent](https://hermes-agent.nousresearch.com/) is the primary *operator brain*** (reasoning, scheduling, multi-channel gateway). **Leadiya remains the system of record** — Postgres, REST API, workers, Baileys, `outreach_log`.

## Principles

| Layer | Owns |
|--------|------|
| **Leadiya** | Data, permissions, queues, audit trail (`outreach_log`, `leads`, `scraper_runs`, …) |
| **Hermes** | Conversation loop, tool choice, memory *about tasks*, optional gateway (Telegram, WhatsApp via its stack, CLI) |

Hermes must **not** become a second database of truth. It should call **your** API for every mutating or sensitive read.

## Authentication (machine → API)

When `AUTH_BYPASS` is **not** `true`, dashboards use Supabase JWT. For Hermes (no user session), use a **service key**:

1. Set in `.env` (API + any runner that calls the API):

   ```bash
   LEADIYA_AGENT_SERVICE_KEY=<long-random-string-min-24-chars>
   ```

2. On every request to `https://<api>/api/...` add:

   ```http
   X-Leadiya-Service-Key: <same value>
   ```

The API treats this as an internal **agent** identity (`user.id` = `agent-service`). Tighten per-route authorization later (e.g. allow only specific paths for the agent).

**Local dev:** `AUTH_BYPASS=true` still bypasses auth for humans; Hermes can use either bypass (same network) or the service key once you turn bypass off.

## Tool catalog (map to existing REST)

Hermes “HTTP tools” should wrap these endpoints (see also [`hermes-tools.manifest.json`](./hermes-tools.manifest.json)).

| Intent | Method | Path | Notes |
|--------|--------|------|--------|
| Health | GET | `/health` | No auth |
| List companies / search | GET | `/api/companies` | `q`, `limit`, `offset`, filters |
| Company detail | GET | `/api/companies/:id` | |
| Outreach sequences | GET | `/api/outreach/sequences` | |
| Sequence detail | GET | `/api/outreach/sequences/:key` | |
| Business hints | GET | `/api/outreach/business` | Baileys / Resend flags |
| Preview message | POST | `/api/outreach/preview` | JSON body |
| Log touch | POST | `/api/outreach/log` | |
| Queue WhatsApp send | POST | `/api/outreach/send` | Requires Baileys |
| Schedule delayed WA | POST | `/api/outreach/schedule` | |
| Send email (Resend) | POST | `/api/outreach/send-email` | Requires `RESEND_API_KEY` |
| Activity log | GET | `/api/outreach/log` | `leadId`, `channel`, `limit` |
| Start 2GIS run | POST | `/api/scrapers/2gis` | Cities/categories |
| Scraper runs | GET | `/api/scrapers/runs` | |

Add more as needed (bulk actions, enrich) — always via API, not direct DB from Hermes.

## Deployment shape

```text
┌─────────────┐     HTTPS + X-Leadiya-Service-Key      ┌──────────────┐
│   Hermes    │ ──────────────────────────────────────►│  Leadiya API │
│  (gateway,  │                                      │  (Hono)      │
│   CLI, cron)│◄──────────────── JSON / errors ──────│              │
└─────────────┘                                      └──────┬───────┘
                                                            │
                                                     Postgres, Redis
```

- **Same host:** Hermes and API on one VM/Docker host — use `http://127.0.0.1:<port>` for calls.
- **Compose:** Optional future `hermes` service; not required for API work — Hermes install follows [upstream docs](https://hermes-agent.nousresearch.com/).

## Phases

1. **Done in repo:** Service-key auth, manifest, verify script, `hermes/README.md` bootstrap.
2. **You / DevOps:** Install Hermes, configure model + `LEADIYA_API_BASE_URL`, store `LEADIYA_AGENT_SERVICE_KEY` in Hermes secrets/env.
3. **Define Hermes skills:** One HTTP skill per critical workflow (e.g. “preview outreach”, “log outbound”, “list hot leads”).
4. **Harden:** Rate limits for `agent-service`, optional IP allowlist, audit log of agent actions.

## Security

- Rotate `LEADIYA_AGENT_SERVICE_KEY` if leaked.
- Agent can read PII in leads — treat Hermes host as **trusted**, network restricted.
- WhatsApp via Baileys remains in **workers**; Hermes triggers sends **only** through `/api/outreach/send` / `schedule`, not parallel unofficial clients unless you explicitly want that (not recommended).

## Verify

```bash
# API + Redis running; LEADIYA_AGENT_SERVICE_KEY set in .env
npm run verify:agent-api
```

Checks `/health`, `/api/system/capabilities`, `/api/companies`, `/api/outreach/business`, `/api/outreach/sequences` with the service key. Optional: set `LEADIYA_VERIFY_LEAD_ID` (and `LEADIYA_VERIFY_SEND=1` for a queued Baileys send) — see `.env.example`.

See [`scripts/verify-agent-api.mjs`](../scripts/verify-agent-api.mjs).
