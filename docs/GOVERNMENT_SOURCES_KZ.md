# Kazakhstan Government & Official Data Sources

## Tier 1: GOVERNMENT PROCUREMENT (Highest Value)

### 1. E-Gazette (Электронный правительственный вестник)
**URL**: https://egov.kz or https://kgd.gov.kz  
**API**: Available via Open Data portal  
**Coverage**: ALL government tenders, contracts, winners  
**Data**:
- Tender announcements
- Winning bidders (company names, BIN)
- Contract values (EXACT amounts!)
- Procurement categories
- Winner history

**Value**: 10/10 - B2G goldmine  
**Scrape Difficulty**: Easy (official API)  
**Unique**: Contract values, proven gov relationships  
**Lead Quality**: Enterprise, pre-qualified, budget confirmed

---

### 2. GosZakup (goszakup.gov.kz)
**URL**: https://goszakup.gov.kz  
**API**: REST API available  
**Coverage**: Public procurement portal  
**Data**:
- Active tenders
- Contract awards
- Supplier database
- Price references
- Plan of procurements

**Value**: 10/10  
**Scrape Difficulty**: Easy (official API with docs)  
**Unique**: Plan of purchases (future opportunities), price analytics  
**API Docs**: https://goszakup.gov.kz/api/

---

### 3. Samruk-Kazyna Procurement
**URL**: https://sk-procurement.kz/ or https://samruk-kazyna.kz  
**Coverage**: National welfare fund tenders (largest SOEs)  
**Data**:
- Kazakhstan Railways (KTZ)
- KazMunayGas (KMG)
- Samruk-Energo
- KazPost
- Air Astana
- etc.

**Value**: 10/10 - Largest companies in KZ  
**Scrape Difficulty**: Medium  
**Unique**: SOE relationships, largest contracts in country

---

## Tier 2: BUSINESS REGISTRY & LEGAL

### 4. Stat.gov.kz (Bureau of National Statistics)
**URL**: https://stat.gov.kz  
**API**: Open data portal  
**Coverage**: Official business statistics  
**Data**:
- Number of active businesses by region
- Industry statistics
- Foreign investment data
- New business registrations

**Value**: 7/10 - Market intelligence  
**Scrape Difficulty**: Easy (open data)  
**Unique**: Official statistics, trend analysis

---

### 5. Enbek.kz (Ministry of Labor)
**URL**: https://www.enbek.kz  
**Coverage**: Employment data, vacancies  
**Data**:
- Registered vacancies
- Employers posting jobs
- Wage statistics
- Industry employment trends

**Value**: 6/10 - Validates hh.kz data  
**Scrape Difficulty**: Easy  
**Unique**: Official employment data

---

### 6. Legal Entities Registry (via OpenData)
**URL**: https://data.egov.kz  
**API**: Available  
**Coverage**: All registered legal entities  
**Data**:
- BIN, name, address
- Registration date
- OKED codes (activity)
- Director names
- Founders/shareholders

**Value**: 8/10 - Similar to Kompra but official  
**Scrape Difficulty**: Easy  
**Unique**: Official government data, founders list

---

## Tier 3: INDUSTRY-SPECIFIC REGULATORS

### 7. National Bank of Kazakhstan
**URL**: https://nationalbank.kz  
**Coverage**: Financial institutions, forex licensees  
**Data**:
- Banks
- Insurance companies
- Microfinance
- Forex bureaus
- Payment systems

**Value**: 7/10 - Financial sector only  
**Scrape Difficulty**: Medium  
**Unique**: Financial sector companies

---

### 8. Financial Market Regulatory Authority (AFN/АРРФР)
**URL**: https://arrfr.kz  
**Coverage**: Regulated financial companies  
**Data**:
- Investment firms
- Asset managers
- Insurance
- Pension funds

**Value**: 6/10 - Financial sector  
**Scrape Difficulty**: Medium

---

### 9. Ministry of Digital Development (MЦРИ)
**URL**: https://micri.gov.kz  
**Coverage**: Telecom, IT companies  
**Data**:
- Telecom licensees
- IT service providers
- Data center operators

**Value**: 6/10 - Tech sector  
**Scrape Difficulty**: Medium

---

### 10. Ministry of Energy
**URL**: https://energy.gov.kz  
**Coverage**: Energy sector companies  
**Data**:
- Oil & gas contractors
- Renewable energy projects
- Mining companies

**Value**: 7/10 - Energy sector (KZ's largest)  
**Scrape Difficulty**: Medium

---

### 11. Committee for Regulation of Natural Monopolies
**URL**: https://kremzk.gov.kz  
**Coverage**: Utilities, infrastructure  
**Data**:
- Utility companies
- Transport companies
- Infrastructure operators

**Value**: 6/10 - Utilities  
**Scrape Difficulty**: Medium

---

## Tier 4: REGIONAL & CITY DATA

### 12. Almaty City Administration
**URL**: https://www.almaty.gov.kz  
**Coverage**: Almaty businesses, city tenders  
**Data**:
- City procurement
- Business licenses
- Investment projects

**Value**: 7/10 - Almaty only (largest city)  
**Scrape Difficulty**: Medium

---

### 13. Astana City Administration
**URL**: https://www.astana.gov.kz  
**Coverage**: Astana government data  
**Similar to Almaty**

---

### 14. Regional Akimats (all 17 regions)
**URLs**: Various (almaty.gov.kz, shymkent.gov.kz, etc.)  
**Coverage**: Regional tenders, businesses  
**Value**: 5/10 - Regional focus  
**Scrape Difficulty**: Medium (many sites)

---

## Tier 5: SPECIALIZED DATABASES

### 15. Tax Committee Debtors List
**URL**: https://kgd.gov.kz  
**Coverage**: Tax debtors (public list)  
**Data**:
- Companies with tax debts
- Amount of debt

**Value**: 5/10 - Negative signal (avoid)  
**Scrape Difficulty**: Easy  
**Unique**: Risk indicator - avoid these companies

---

### 16. Judicial Database (Adilet)
**URL**: https://adilet.gov.kz  
**Coverage**: Court cases, legal entities  
**Data**:
- Companies in litigation
- Bankruptcy proceedings
- Administrative violations

**Value**: 4/10 - Risk screening  
**Scrape Difficulty**: Hard  
**Unique**: Legal risk assessment

---

### 17. Intellectual Property Registry
**URL**: https://kazpatent.kz  
**Coverage**: Trademark/patent holders  
**Data**:
- Companies with patents
- Trademark owners

**Value**: 4/10 - Innovation companies  
**Scrape Difficulty**: Medium

---

## Summary: Build Priority for Government Sources

### Immediate (Build First)
1. **GosZakup.gov.kz** - API available, procurement data
2. **E-Gazette / data.egov.kz** - Official registry, open data
3. **Samruk-Kazyna procurement** - Largest SOEs

### Secondary
4. **Stat.gov.kz** - Business statistics
5. **Enbek.kz** - Employment validation
6. **National Bank registry** - Financial companies

### Skip or Manual
- Individual ministry sites (too many, low return)
- Regional akimats (unless targeting specific region)
- Tax debtors (use for filtering, not lead gen)

---

## API Availability Summary

| Source | Has API | API Quality | Auth Required |
|--------|---------|-------------|---------------|
| GosZakup | ✅ | Excellent (REST) | No |
| data.egov.kz | ✅ | Good | No |
| Stat.gov.kz | ✅ | Good | No |
| Enbek.kz | ✅ | Moderate | No |
| National Bank | ✅ | Moderate | No |
| Samruk-Kazyna | ❌ | HTML scrape | No |
| Kompra.kz | ✅ | Good | No |
| 2GIS | ❌ | Browser/Reverse | No |

---

## Key Insight

**Government sources are BETTER than commercial for KZ because:**
1. ✅ API access is often free and open
2. ✅ Data is authoritative (no guessing)
3. ✅ BIN numbers allow cross-referencing
4. ✅ Contract values show real budgets
5. ✅ Procurement history shows relationships

**For B2B sales in KZ**: Government procurement winners are the BEST leads - they're proven to have budget, decision-making process, and need for services.
