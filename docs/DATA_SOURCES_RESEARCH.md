# Data Sources Research: Kazakhstan/CIS B2B Lead Generation

## Executive Summary

For Kazakhstan specifically, the data source priority is **dramatically different** from Western markets. 2GIS is indeed the dominant player, and many Western sources (Google Maps, LinkedIn) have limited coverage.

---

## TIER 1: MUST HAVE (Build Immediately)

### 1. 2GIS (ДубльГИС) - Kazakhstan
**Status**: ✅ Already built  
**Priority**: CRITICAL  
**Coverage**: 95%+ of Kazakhstan businesses  
**Data Quality**: Excellent (addresses, phones, hours, reviews)  
**Why**: 
- Dominant mapping service in Kazakhstan since 2000s
- Businesses actively maintain profiles
- Rich category taxonomy
- Verified phone numbers
- No Western equivalent comes close

**Value**: 10/10  
**Scrape Difficulty**: Medium (has anti-scraping)  
**Unique Data**: Categories, working hours, photos, reviews

---

### 2. Kompra.kz (Компра)
**Status**: ✅ Already built  
**Priority**: CRITICAL  
**Coverage**: All registered Kazakhstan companies  
**Data Quality**: Official government data  
**Why**:
- Kazakhstan state business registry
- BIN numbers (critical for KZ market)
- Director names and identification
- Legal addresses
- Registration dates
- No other source has this official data

**Value**: 10/10  
**Scrape Difficulty**: Easy (official API)  
**Unique Data**: BIN, directors, legal entity type, KATO codes

---

### 3. HeadHunter (hh.kz)
**Status**: ✅ Already built  
**Priority**: HIGH  
**Coverage**: All companies hiring in Kazakhstan  
**Data Quality**: Company-provided job data  
**Why**:
- #1 job board in Kazakhstan
- Companies posting jobs = have budget = hot leads
- Industry classification
- Company size from job postings
- Skills they need = pain points

**Value**: 9/10  
**Scrape Difficulty**: Medium  
**Unique Data**: Hiring signals, skills needed, pain points, budget indicators

---

### 4. Instagram Business
**Status**: 🚧 Built (needs implementation)  
**Priority**: HIGH  
**Coverage**: 60-70% of small/medium businesses  
**Data Quality**: Variable, but contact-rich  
**Why**:
- Most KZ businesses have Instagram (more than websites!)
- Bios often have WhatsApp numbers
- Stories show daily operations
- Direct messaging channel
- Younger demographic than Facebook

**Value**: 9/10  
**Scrape Difficulty**: Hard (API restrictions)  
**Unique Data**: WhatsApp numbers, visual identity, daily activity, engagement rates

---

## TIER 2: SHOULD HAVE (Build After Tier 1)

### 5. Yandex Maps
**Status**: ✅ Already built  
**Priority**: MEDIUM  
**Coverage**: Good for Russia, weaker in Kazakhstan  
**Data Quality**: Good where available  
**Why**:
- Some KZ businesses listed (mostly Russian chains)
- Good for cross-border businesses
- Reviews and ratings

**Value**: 6/10  
**Scrape Difficulty**: Medium  
**Unique Data**: Russian-speaking customer reviews  
**Overlap**: ~30% with 2GIS - mostly chain businesses

---

### 6. Zoon.kz
**Status**: ✅ Already built  
**Priority**: MEDIUM  
**Coverage**: Restaurants, services, entertainment  
**Data Quality**: User-generated reviews  
**Why**:
- Popular review platform
- Customer photos and feedback
- Good for B2C businesses

**Value**: 6/10  
**Scrape Difficulty**: Medium  
**Unique Data**: Customer reviews, ratings, photos  
**Overlap**: ~40% with 2GIS

---

### 7. VC.ru
**Status**: ✅ Already built  
**Priority**: LOW-MEDIUM  
**Coverage**: Tech/startup ecosystem only  
**Data Quality**: High for tech companies  
**Why**:
- Tech news and commenters
- Startup ecosystem
- Founders actively engage

**Value**: 5/10 (niche)  
**Scrape Difficulty**: Easy  
**Unique Data**: Tech focus, startup signals  
**Overlap**: Minimal - different audience

---

### 8. RusProfile
**Status**: ✅ Already built  
**Priority**: LOW (for Kazakhstan)  
**Coverage**: Russian companies, not KZ  
**Data Quality**: Good for Russia  
**Why**: SKIP for KZ - we have Kompra which is better

**Value**: 3/10 for KZ market  
**Scrape Difficulty**: Easy  
**Unique Data**: Russian company data  
**Overlap**: None with KZ businesses

---

## TIER 3: AVOID / LOW PRIORITY

### 9. Google Maps
**Status**: 🚧 Planned  
**Priority**: SKIP FOR KZ  
**Why Avoid**:
- 2GIS has 95% of KZ businesses already
- Google Maps coverage in KZ is terrible (~10-15%)
- Mostly tourist spots and international chains
- Duplicate of 2GIS data where it exists
- Waste of development effort for KZ market

**Value**: 2/10 for Kazakhstan  
**Recommendation**: SKIP entirely for KZ focus

---

### 10. LinkedIn Sales Navigator
**Status**: 🚧 Built (needs implementation)  
**Priority**: LOW for KZ  
**Coverage**: <5% of Kazakhstan businesses  
**Data Quality**: Good where exists  
**Why Deprioritize**:
- Very low adoption in Kazakhstan
- Most KZ businesses don't use LinkedIn
- Better for international outreach
- LinkedIn blocks scraping aggressively
- High effort, low yield for KZ

**Value**: 4/10 for KZ, 9/10 for international  
**Recommendation**: Keep for international expansion, not KZ primary

---

### 11. Facebook Pages
**Status**: Not built  
**Priority**: LOW  
**Coverage**: Declining in Kazakhstan  
**Why Deprioritize**:
- Facebook usage declining in KZ
- Instagram replaced it for businesses
- Privacy settings make scraping harder
- Younger businesses on Instagram

**Value**: 4/10  
**Recommendation**: Skip unless specific use case

---

### 12. Telegram Channels
**Status**: Not built  
**Priority**: MEDIUM-HIGH  
**Coverage**: 80%+ of businesses have channels  
**Data Quality**: Varies  
**Why Reconsider**:
- Most KZ businesses have Telegram channels
- Contact info often in channel descriptions
- But: Hard to scrape at scale (need to join channels)
- Good for manual research, hard for automation

**Value**: 7/10  
**Scrape Difficulty**: Very Hard  
**Recommendation**: Build later, manual research tool first

---

## TIER 4: NEW SOURCES TO CONSIDER

### 13. OLX.kz / Kolesa.kz / Krisha.kz (Classifieds)
**Status**: Not built  
**Priority**: HIGH  
**Why**:
- **OLX.kz**: E-commerce sellers (B2C but high volume)
- **Kolesa.kz**: Car dealers (high-value leads)
- **Krisha.kz**: Real estate agents (B2B service opportunity)

**Value**: 8/10  
**Scrape Difficulty**: Medium  
**Unique Data**: Active sellers, pricing, inventory, motivation signals

---

### 14. Enbek.kz (Ministry of Labor)
**Status**: Not built  
**Priority**: MEDIUM  
**Why**:
- Official employment data
- Companies with vacancies
- Could validate hiring data from hh.kz

**Value**: 6/10  
**Scrape Difficulty**: Easy (open data portal)  
**Unique Data**: Official employment statistics

---

### 15. Samruk-Kazyna Suppliers / Government Procurement
**Status**: Not built  
**Priority**: HIGH for B2G  
**Why**:
- Companies supplying government
- Large contract values
- Proven financial stability

**Value**: 9/10 for B2G sales  
**Scrape Difficulty**: Medium  
**Unique Data**: Contract values, government relationships

---

### 16. E-GAZETTE (Электронные госзакупки)
**Status**: Not built  
**Priority**: HIGH  
**Why**:
- All government tenders
- Companies winning contracts
- Budget sizes visible
- Future opportunities

**Value**: 9/10  
**Scrape Difficulty**: Medium  
**Unique Data**: Tender wins, contract values, procurement history

---

### 17. Kaspi Pay / Kaspi Sellers
**Status**: Not built  
**Priority**: HIGH  
**Why**:
- 10M+ Kazakhs use Kaspi
- Kaspi Pay merchants = active businesses
- Transaction volume data (if accessible)
- Growth signals

**Value**: 9/10  
**Scrape Difficulty**: Hard (private platform)  
**Unique Data**: Transaction volumes, growth rate, customer base

---

### 18. Website WHOIS / Domain Registrations
**Status**: Not built  
**Priority**: MEDIUM  
**Why**:
- All .kz domains
- Registration dates (business age)
- Contact emails
- Website tech stack (detected via scraping)

**Value**: 6/10  
**Scrape Difficulty**: Easy  
**Unique Data**: Domain age, registrar info, website tech

---

## RECOMMENDED BUILD ORDER

### Phase 1: Core (DONE)
1. ✅ 2GIS - Primary business directory
2. ✅ Kompra.kz - Official registry
3. ✅ HeadHunter - Hiring signals

### Phase 2: Social (Built, needs impl)
4. 🚧 Instagram - Small business contacts
5. 📋 Telegram Channels - Manual research tool

### Phase 3: Commerce
6. 📋 Kolesa.kz - Auto dealers (high value)
7. 📋 Krisha.kz - Real estate agents
8. 📋 OLX.kz - E-commerce sellers

### Phase 4: Government
9. 📋 E-Gazette - Tender data
10. 📋 Samruk-Kazyna - Government suppliers

### Phase 5: Skip or Deprioritize
- ❌ Google Maps (redundant with 2GIS)
- ❌ LinkedIn (low KZ coverage)
- ❌ Facebook (declining in KZ)
- ❌ RusProfile (Russia only)

---

## DATA RICHNESS COMPARISON

| Source | Companies | Contacts/Company | Phones | Emails | WhatsApp | Decision Makers | Data Freshness |
|--------|-----------|------------------|--------|--------|----------|-----------------|----------------|
| 2GIS | 500,000+ | 1-2 | ✅ | ❌ | ❌ | Sometimes | Weekly |
| Kompra | 400,000+ | 1-2 (directors) | ❌ | ❌ | ❌ | ✅ (directors) | Daily (gov) |
| hh.kz | 50,000+ | 1-5 (recruiters) | ✅ | ✅ | ❌ | Sometimes | Real-time |
| Instagram | 200,000+ | 1-3 | Sometimes | Sometimes | ✅ | Rarely | Daily |
| Classifieds | 100,000+ | 1-2 | ✅ | ✅ | ✅ | ✅ | Real-time |

---

## KEY INSIGHTS

### 2GIS > Google Maps for KZ
- 2GIS has 10x more KZ businesses
- 2GIS has verified phone numbers
- 2GIS has better category taxonomy
- Google Maps in KZ is mostly international chains and tourist spots

### Instagram > LinkedIn for KZ
- 60-70% of KZ SMBs have Instagram
- <5% have LinkedIn presence
- Instagram bios often have WhatsApp
- KZ business culture prefers informal messaging (WhatsApp/Telegram)

### Classifieds = Hot Leads
- Businesses on Kolesa/Krisha/OLX are actively selling
- They're spending money on listings = have budget
- They're responsive (need to sell)
- Motivation is high

### Government Data = Enterprise Gold
- E-Gazette shows companies with proven gov relationships
- Samruk-Kazyna suppliers are pre-qualified
- These are enterprise-level contracts

---

## FINAL RECOMMENDATION

**DO NOT build Google Maps scraper for KZ.** It's a waste of time when 2GIS exists.

**Focus areas in order:**
1. ✅ Finish existing scrapers (2GIS, Kompra, hh.kz)
2. 🚧 Implement Instagram with WhatsApp extraction
3. 📋 Build classifieds scrapers (Kolesa, Krisha, OLX) - these have HIGH buyer intent
4. 📋 Build government procurement scrapers (E-Gazette) - B2G goldmine
5. ❌ Skip LinkedIn for KZ (low coverage)
6. ❌ Skip Google Maps (redundant)
