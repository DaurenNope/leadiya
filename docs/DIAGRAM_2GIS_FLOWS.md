# 2GIS flows — diagrams (dashboard vs extension)

Plain-language companion to the scraper: what runs where, and why two different paths exist.

---

## 1. `run2GisScraper` — what actually runs (high level)

This is the **automated headless** pipeline started by **`POST /api/scrapers/2gis`** (dashboard, Hermes, or curl). It lives in `@leadiya/scrapers` (`run2GisScraper` → Crawlee `PlaywrightCrawler` → `scrapeCityCategory` per city×category slice).

```mermaid
flowchart TB
  subgraph trigger["Who starts it"]
    D[Dashboard modal]
    H[Hermes HTTP tool]
    C[curl / scripts]
  end

  subgraph api["Leadiya API (Hono)"]
    P["POST /api/scrapers/2gis"]
    SR[(scraper_runs row\nstatus = running)]
    P --> SR
    BG["run2GisScraper(...) — fire-and-forget\nruns inside API Node process"]
    SR --> BG
    HTTP202["HTTP 202 + runId\nreturns immediately"]
    P --> HTTP202
  end

  subgraph scraper["@leadiya/scrapers — run2GisScraper"]
    REQ["buildTwogisStartRequests\n= 1 Crawlee job per city × category"]
    CR["PlaywrightCrawler\n(maxConcurrency browsers)"]
    RH["requestHandler per slice:\nscrapeCityCategory(page, city, category, …)"]
    REQ --> CR --> RH

    subgraph slice["One slice (one search query)"]
      LOOP["Loop: search page 1, 2, … /page/N"]
      LIST["runSearchListPhase:\nopen search URL, scroll,\ncollect /firm/ links"]
      DEDUP["Skip URLs already in DB;\npace between details"]
      DET["scrapeCompanyDetail:\nopen firm card, extract fields"]
      INS["INSERT leads + contacts;\nbump scraper_runs stats"]
      STOP{"3 empty search pages\nin a row?"}
      LOOP --> LIST --> DEDUP --> DET --> INS
      INS --> STOP
      STOP -->|no| LOOP
      STOP -->|yes| DONE[Slice finished]
    end

    RH --> slice
  end

  subgraph finish["When all slices finish"]
    UP["UPDATE scraper_runs\nstatus = done | error"]
    ENQ["Optional: BullMQ enrich job\nfor new lead IDs"]
    BG --> scraper --> UP
    UP --> ENQ
  end

  trigger --> P

  subgraph ui["Dashboard poll"]
    BAN["GET /api/scrapers/runs/:id\n(ScraperRunBanner)"]
  end
  SR -.-> BAN
```

**Reading the slice box:** for each **city + category**, the scraper opens **paginated search URLs** (`…/search/query`, then `…/page/2`, …). On each search page it collects **firm links**, then opens **each firm** in the same browser tab, saves to Postgres, and updates live counters. It stops that slice after **three consecutive search pages with zero firms** (not “only three pages ever”).

---

## 2. Why the **extension** and the **dashboard/API scraper** use different paths

They solve **different jobs** with **different runtimes**.

```mermaid
flowchart LR
  subgraph auto["Automated crawl — run2GisScraper"]
    SRV["Server: Playwright + Crawlee"]
    DB1["Same Postgres\nleads.source = 2gis"]
    SRV --> DB1
  end

  subgraph manual["Browser extension — user on 2gis.kz"]
    EXT["Chrome: content script + dock"]
    BULK["POST /api/leads/bulk"]
    DB2["Same Postgres\noften source = 2gis-extension"]
    EXT --> BULK --> DB2
  end
```

| | **Dashboard / API scraper** | **Extension** |
|---|-----------------------------|---------------|
| **Who drives** | Server process (no human on 2GIS) | User already browsing 2GIS |
| **Tooling** | Playwright Chromium, Crawlee queues, optional proxy | DOM in the user’s tab, queued flush to API |
| **API endpoint** | `POST /api/scrapers/2gis` → `run2GisScraper` | `POST /api/leads/bulk` (bulk payloads) |
| **Best for** | Large city×category runs, pagination, many cards | Quick capture, current page, operator workflow |
| **Same DB?** | Yes — both write **leads**; source field differs (e.g. `2gis` vs `2gis-extension`) |

So it is not “two random tools”: **one is bulk unattended scraping**, the **other is human-in-the-loop capture** into the same CRM. Hermes, if you use it, should call the **same REST** routes (`/api/scrapers/2gis` or `/api/leads/bulk` patterns) — not a third database.

---

## 3. See also

- [`docs/HERMES_INTEGRATION.md`](./HERMES_INTEGRATION.md) — agent as operator, API as system of record
- [`docs/progress/ARCHITECTURE.md`](./progress/ARCHITECTURE.md) — broader repo layout (if present)
