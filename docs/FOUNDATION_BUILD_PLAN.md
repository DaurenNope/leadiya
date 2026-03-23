# Foundation Database Build Plan

## Strategy
Build comprehensive database FIRST from sources that don't require captchas/proxies.
This becomes our foundation for sales, then we add premium captcha-protected sources.

---

## PHASE 1: No Captcha Required (Build Now)

### 1. Government APIs (High Priority)
**GosZakup.gov.kz API**
- ✅ Public API available
- ✅ No rate limiting issues
- ✅ High-value B2G leads
- **Target:** 10,000+ companies with contract data
- **Fields:** BIN, company name, contract values, procurement contacts

**data.egov.kz API**
- ✅ Official government data
- ✅ Legal entities database
- **Target:** 500,000+ registered companies
- **Fields:** BIN, OKED, KATO, registration data

### 2. International Directories (Working)
**LinkedIn**
- ✅ Sales Navigator or basic search
- ✅ Kazakhstan-focused queries
- **Target:** 50,000+ decision makers
- **Fields:** Name, title, company, location

**Instagram**
- ✅ Business profiles via hashtags
- ✅ Contact info in bios
- **Target:** 30,000+ businesses
- **Fields:** Business name, phone, WhatsApp, Instagram

### 3. Supplementary Sources
**Yandex Maps** (may work without captcha for limited queries)
**VC.ru / Habr** - Tech companies
**Zoon** - Service businesses (Russia focus)
**Rusprofile** - Russian companies

---

## PHASE 2: Captcha Required (Add Later)

### Premium Kazakhstan Sources
**2GIS** - 500K+ businesses (HEAVY protection)
**hh.kz** - Job postings → companies hiring
**Kolesa.kz** - Auto dealers
**Krisha.kz** - Real estate
**OLX.kz** - Business sellers
**Kompra.kz** - Business directory

---

## Expected Foundation Database Size

| Source | Estimated Records | Quality |
|--------|------------------|---------|
| GosZakup API | 10,000 | ⭐⭐⭐⭐⭐ |
| data.egov.kz | 500,000 | ⭐⭐⭐ |
| LinkedIn | 50,000 | ⭐⭐⭐⭐⭐ |
| Instagram | 30,000 | ⭐⭐⭐⭐ |
| Other APIs | 20,000 | ⭐⭐⭐ |
| **TOTAL FOUNDATION** | **~610,000** | **High** |

---

## Data Enrichment Pipeline

### Step 1: Discovery
Scrape from all available sources → `DiscoveredLead` objects

### Step 2: Deduplication
- Match by BIN (Kazakhstan)
- Match by INN (Russia)
- Match by Company Name + City
- Merge duplicates into single records

### Step 3: Enrichment
- Cross-reference sources
- Validate phone numbers
- Infer roles from titles
- Score data quality

### Step 4: Storage
Store in `foundation_leads` table with full provenance

---

## Sales-Ready Segments

### Segment 1: Government Contractors (Highest Value)
- Source: GosZakup
- Size: ~10,000
- Price: $1,500
- Buyers: B2G service providers

### Segment 2: Active Businesses with Contacts
- Multi-source merged
- Size: ~100,000
- Price: $2,000
- Buyers: General B2B sales

### Segment 3: Complete Database
- All foundation data
- Size: ~600,000
- Price: $5,000
- Buyers: Data aggregators, enterprises

---

## Implementation Priority

### Week 1-2: Core APIs
1. Fix GosZakup API integration
2. Fix data.egov.kz API integration  
3. Build deduplication engine
4. Create foundation database tables

### Week 3-4: Social/Professional
5. LinkedIn scraper (working version)
6. Instagram scraper (hashtag-based)
7. Merge all sources

### Week 5: Enrichment & Export
8. Data quality scoring
9. Export formats (CSV, Excel, JSON)
10. Sales package generation

### Week 6+: Premium Sources (With Captcha)
11. 2GIS (with extension)
12. Classifieds (with extension)
13. hh.kz (with extension)

---

## Success Metrics

- [ ] 500,000+ companies in database
- [ ] 80%+ have at least 1 contact method
- [ ] 50%+ have phone or email
- [ ] Deduplication rate < 10% (not too many duplicates)
- [ ] First sale completed

---

## Technical Requirements

### No Captcha Needed For:
- Government APIs (GosZakup, data.egov.kz)
- LinkedIn (if using proper API/rate limits)
- Instagram (if using proper API)
- Some international sources

### Captcha Extension For:
- 2GIS (Cloudflare + bot detection)
- hh.kz (aggressive blocking)
- Classifieds (rate limiting)
- Kompra.kz (geo-restrictions)
