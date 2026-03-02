---
name: sales-engine
description: Fully automated lead generation, qualification, outreach, and closing
version: 1.0.0
requires:
  - moltbot.browser  # For LinkedIn scraping
  - moltbot.channels # WhatsApp, Telegram, Email
---

# Sales Engine

Automated B2B sales pipeline for any business. Discovers leads, qualifies them against your ICP, runs personalized outreach sequences, and tracks the pipeline.

## Commands

| Command | Description |
|---------|-------------|
| `/pipeline` | View pipeline status and lead counts |
| `/leads [state]` | List leads, optionally filter by state |
| `/lead <id>` | View lead details with action buttons |
| `/discover` | Trigger manual discovery run |
| `/outreach` | Run outreach cycle for ready leads |
| `/stats` | View conversion metrics |
| `/pause` | Pause all automation |
| `/resume` | Resume automation |

## Automation (Cron)

| Schedule | Action |
|----------|--------|
| Every 6h | Discovery run (LinkedIn, webhooks) |
| Every 1h | Process outreach queue |

## Discovery Sources

### B2B Company Directories (Primary)
- **2GIS** — Company listings by category (IT-компании, веб-студии)
- **Kompra.kz** — Kazakhstan registry with director names
- **Rusprofile.ru** — Russian registry (INN, director, revenue)
- **Yandex Maps** — Business listings across CIS
- **Zoon.ru** — Reviews directory with ratings

### CIS-Focused
- **Telegram Groups** — Startup/dev communities
- **HeadHunter.kz/ru** — Companies hiring developers
- **VC.ru** — Tech founders writing about startups

### Global
- **LinkedIn** — Browser scraper (requires login)
- **Webhooks** — Inbound leads from forms
- **CSV/JSON** — Bulk imports

## Channel Priority

1. **WhatsApp** (via Moltbot Baileys)
2. **Email** (Resend/SendGrid/SMTP)
3. **Telegram** (Bot API)

Messages automatically fall back to the next channel if primary fails.

## Configuration

Edit these files in `config/`:
- `business.yml` — Company info, channel settings
- `icp.yml` — Target customer profile, scoring
- `sequences.yml` — Outreach templates, timing
