/**
 * Mass 2GIS Scraper
 * Scrapes ALL business categories across ALL Kazakhstan cities.
 * Uses deep scan: clicks "Show phone" on every listing.
 *
 * Architecture:
 *   - Queue-based: produces city×category jobs, workers consume them
 *   - Checkpointing: saves progress to Redis, resumes on crash
 *   - Validation gate: rejects leads without verified contacts
 *   - Bulk insert: batches of 100 to Supabase
 *
 * Usage:
 *   npx tsx src/mass-2gis-scraper.ts                     # full run
 *   npx tsx src/mass-2gis-scraper.ts --city almaty       # single city
 *   npx tsx src/mass-2gis-scraper.ts --resume             # resume from checkpoint
 */

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';
import { validateLead, normalizePhone, type RawLead } from './validation-gate.js';
import { createClient as createRedisClient } from 'redis';

// ═══════════════════════════════════════════════════════════════
// STAGE 1 CONFIGURATION — Almaty Targeted Scrape
// ═══════════════════════════════════════════════════════════════

// Stage 1: Almaty only. Stage 2: + Astana. Stage 3: All KZ.
const STAGE_1_CITIES = ['almaty'];
const STAGE_2_CITIES = ['almaty', 'astana'];
const ALL_KZ_CITIES = [
    'almaty', 'astana', 'shymkent', 'karaganda', 'aktobe',
    'atyrau', 'aktau', 'pavlodar', 'semey', 'kostanay',
    'taraz', 'oral', 'petropavl', 'turkistan', 'kyzylorda',
    'taldykorgan', 'ekibastuz', 'temirtau', 'rudny',
];

// TIER A: Owner answers WhatsApp, high social presence, recurring buys
const TIER_A_CATEGORIES = [
    'рестораны', 'кафе', 'кофейни',           // HoReCa core
    'салоны красоты', 'барбершопы',            // Beauty
    'стоматологии',                            // Medical (high LTV)
    'фитнес-клубы',                            // Fitness
    'автосервисы', 'автомойки',                // Auto
    'клининговые компании',                    // B2B services
];

// TIER B: Strong second wave — slightly longer sales cycle
const TIER_B_CATEGORIES = [
    'медицинские центры', 'ветеринарные клиники',
    'ремонт квартир', 'строительные компании',
    'агентства недвижимости',
    'организация мероприятий',
    'пекарни', 'кондитерские',
    'фотостудии', 'цветочные магазины',
    'юридические услуги', 'бухгалтерские услуги',
    'рекламные агентства',
];

// TIER C: Future expansion
const TIER_C_CATEGORIES = [
    'отели', 'гостиницы', 'хостелы',
    'фастфуд', 'пиццерии', 'суши-бары',
    'мебельные магазины', 'магазины электроники',
    'типографии', 'полиграфия',
    'IT-компании', 'веб-студии',
    'курсы', 'языковые курсы',
];

const CONFIG = {
    maxPagesPerCategory: 20,          // 20 pages × ~12 items = ~240 per category
    delayBetweenPagesMin: 1500,       // Jittered: 1.5-3.5s between page loads
    delayBetweenPagesMax: 3500,
    delayBetweenClicksMin: 600,       // Jittered: 0.6-1.5s between detail pages
    delayBetweenClicksMax: 1500,
    maxConcurrentTabs: 3,             // parallel browser tabs
    batchInsertSize: 100,             // Supabase batch size
    phoneRevealTimeout: 3000,         // wait for phone to appear
    checkpointKey: 'scrape:2gis:checkpoint',
    progressKey: 'scrape:2gis:progress',
};

/** Jittered delay — random between min and max ms */
function jitter(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Global firm ID dedup — tracks /firm/XXXX IDs across ALL categories */
const globalSeenFirmIds = new Set<string>();

/** Extract firm ID from 2GIS URL: /firm/70000001XXXXX → 70000001XXXXX */
function extractFirmId(url: string): string | null {
    const match = url.match(/\/firm\/(\d+)/);
    return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ScrapeJob {
    city: string;
    category: string;
    page: number;
}

interface ScrapeResult {
    leads: RawLead[];
    totalFound: number;
    pagesScraped: number;
    phonesRevealed: number;
}

interface Progress {
    totalJobs: number;
    completedJobs: number;
    totalLeads: number;
    validLeads: number;
    rejectedLeads: number;
    byCity: Record<string, number>;
    byCategory: Record<string, number>;
    startedAt: string;
    lastUpdated: string;
}

// ═══════════════════════════════════════════════════════════════
// CHECKPOINT MANAGER
// ═══════════════════════════════════════════════════════════════

class CheckpointManager {
    private redis: ReturnType<typeof createRedisClient> | null = null;

    async connect() {
        this.redis = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        await this.redis.connect();
    }

    async isCompleted(city: string, category: string): Promise<boolean> {
        if (!this.redis) return false;
        const key = `${CONFIG.checkpointKey}:${city}:${category}`;
        const val = await this.redis.get(key);
        return val === 'done';
    }

    async markCompleted(city: string, category: string, leadsFound: number): Promise<void> {
        if (!this.redis) return;
        const key = `${CONFIG.checkpointKey}:${city}:${category}`;
        await this.redis.set(key, 'done');

        // Log to progress
        const pKey = CONFIG.progressKey;
        const raw = await this.redis.get(pKey);
        const progress: Progress = raw ? JSON.parse(raw) : this.emptyProgress();
        progress.completedJobs++;
        progress.totalLeads += leadsFound;
        progress.byCity[city] = (progress.byCity[city] || 0) + leadsFound;
        progress.byCategory[category] = (progress.byCategory[category] || 0) + leadsFound;
        progress.lastUpdated = new Date().toISOString();
        await this.redis.set(pKey, JSON.stringify(progress));
    }

    async getProgress(): Promise<Progress> {
        if (!this.redis) return this.emptyProgress();
        const raw = await this.redis.get(CONFIG.progressKey);
        return raw ? JSON.parse(raw) : this.emptyProgress();
    }

    async resetAll(): Promise<void> {
        if (!this.redis) return;
        const keys = await this.redis.keys(`${CONFIG.checkpointKey}:*`);
        if (keys.length > 0) await this.redis.del(keys);
        await this.redis.del(CONFIG.progressKey);
    }

    async disconnect() {
        if (this.redis) await this.redis.disconnect();
    }

    private emptyProgress(): Progress {
        return {
            totalJobs: 0, completedJobs: 0, totalLeads: 0,
            validLeads: 0, rejectedLeads: 0,
            byCity: {}, byCategory: {},
            startedAt: new Date().toISOString(), lastUpdated: new Date().toISOString(),
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// 2GIS DETAIL PAGE SCRAPER
// ═══════════════════════════════════════════════════════════════

/**
 * Collect firm links from a search results page (list view).
 * We only need names + URLs here — the real data comes from detail pages.
 */
async function collectFirmLinks(page: Page): Promise<{ name: string; href: string }[]> {
    return page.evaluate(() => {
        const entries: { name: string; href: string }[] = [];
        const seen = new Set<string>();
        document.querySelectorAll('a[href*="/firm/"]').forEach(link => {
            const href = (link as HTMLAnchorElement).href;
            const name = link.textContent?.trim() || '';
            if (name && name.length > 1 && !seen.has(href)) {
                seen.add(href);
                entries.push({ name, href });
            }
        });
        return entries;
    });
}

/**
 * Inject a base64 redirect URL decoder into the page context.
 * 2GIS wraps all external/social links through link.2gis.com with
 * base64-encoded target URLs. This helper decodes them.
 */
async function injectHelpers(page: Page): Promise<void> {
    await page.evaluate(() => {
        // @ts-ignore — attach to window so it persists across evaluations
        (window as any).__decodeRedirect = function (href: string) {
            if (!href.includes('link.2gis.com')) return href;
            try {
                var parts = href.split('/');
                var payload = parts[parts.length - 1];
                var decoded = atob(decodeURIComponent(payload).split('\n')[0]);
                return decoded;
            } catch (e) {
                return href;
            }
        };
    });
}

/**
 * Extract MAXIMIZED contact info from a 2GIS company detail page.
 * Extracts: phones, emails, social links (decoded from base64 redirects),
 * website, address, review count, working hours, and features/amenities.
 */
async function scrapeCompanyDetail(page: Page): Promise<{
    phones: string[]; email: string; instagram: string;
    whatsapp: string; telegram: string; facebook: string;
    website: string; address: string;
    reviewCount: number; hours: string; features: string[];
}> {
    // Click "Show phones" button to reveal hidden phone numbers
    try {
        const showPhonesBtn = await page.$('button:has-text("Показать телефон")');
        if (showPhonesBtn) {
            await showPhonesBtn.click();
            await page.waitForTimeout(1500);
        }
    } catch { }

    // Inject the base64 URL decoder
    await injectHelpers(page);

    return page.evaluate(() => {
        const decode = (window as any).__decodeRedirect;
        const body = document.body?.textContent || '';

        // ═══ PHONES — tel: links + text patterns ═══
        const phones: string[] = [];
        document.querySelectorAll('a[href^="tel:"]').forEach(a => {
            const digits = (a as HTMLAnchorElement).href.replace('tel:', '').replace(/\D/g, '');
            if (digits.length >= 10 && !phones.includes(digits)) phones.push(digits);
        });
        const phoneMatches = body.match(/[\+]?[78][\s\-‒–]?\(?\d{3}\)?[\s\-‒–]?\d{3}[\s\-‒–]?\d{2}[\s\-‒–]?\d{2}/g);
        if (phoneMatches) {
            phoneMatches.forEach(p => {
                const d = p.replace(/\D/g, '');
                if (d.length >= 10 && !phones.includes(d)) phones.push(d);
            });
        }

        // ═══ EMAILS — mailto: links (most reliable) + text patterns ═══
        const emails: string[] = [];
        document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
            const email = (a as HTMLAnchorElement).href.replace('mailto:', '').split('?')[0].trim();
            if (email && !emails.includes(email)) emails.push(email);
        });
        const email = emails[0] || '';

        // ═══ SOCIAL LINKS — match by aria-label, decode base64 redirects ═══
        let instagram = '', whatsapp = '', telegram = '', facebook = '', website = '';

        const links = Array.from(document.querySelectorAll('a[href]'));
        for (let i = 0; i < links.length; i++) {
            const a = links[i] as HTMLAnchorElement;
            const href = a.href;
            const label = (a.getAttribute('aria-label') || a.textContent || '').toLowerCase().trim();

            if (label.includes('instagram') && !instagram) {
                instagram = decode(href);
            } else if (label.includes('whatsapp') && !whatsapp) {
                whatsapp = decode(href);
            } else if (label.includes('telegram') && !telegram) {
                telegram = decode(href);
            } else if (label.includes('facebook') && !facebook) {
                facebook = decode(href);
            }
        }

        // Website: look for aria-label "сайт" or direct external link
        for (let i = 0; i < links.length; i++) {
            if (website) break;
            const a = links[i] as HTMLAnchorElement;
            const label = (a.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('сайт') || label.includes('website')) {
                website = decode(a.href);
            } else if (!a.href.includes('2gis') && !a.href.includes('link.2gis.com') &&
                a.href.startsWith('http') && !a.href.includes('google') && !a.href.includes('yandex') &&
                !a.href.includes('apple.com') && !a.href.includes('play.google')) {
                website = a.href;
            }
        }

        // ═══ ADDRESS ═══
        let address = '';
        const addrMatch = body.match(/(ул\.|улица|пр\.|просп\.|мкр\.|бул\.|пер\.|наб\.)[\s\S]{3,80}/i);
        if (addrMatch) address = addrMatch[0].split('\n')[0].trim().substring(0, 80);

        // ═══ REVIEWS ═══
        const reviewMatch = body.match(/(\d+)\s*(?:отзыв|оценк)/i);
        const reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;

        // ═══ WORKING HOURS ═══
        let hours = '';
        const hoursMatch = body.match(/(Ежедневно|Круглосуточно|Пн[\s–\-]+(?:Вс|Пт|Сб))/);
        if (hoursMatch) {
            const idx = body.indexOf(hoursMatch[0]);
            const block = body.substring(idx, idx + 60);
            const timeMatch = block.match(/(Ежедневно|Круглосуточно|Пн[\s–\-]+\S+)\s*(с\s*\d{1,2}:\d{2}\s*до\s*\d{1,2}:\d{2})?/);
            hours = timeMatch ? timeMatch[0].trim() : hoursMatch[0];
        }

        // ═══ FEATURES / AMENITIES ═══
        const featureRe = /(Wi-Fi|парковка|доставка|самовывоз|бронирование|кальян|live|банкет|VIP|караоке|завтрак|ланч|бизнес-ланч|летняя веранда)/gi;
        const features = [...new Set((body.match(featureRe) || []).map((f: string) => f.toLowerCase()))];

        return {
            phones, email, instagram, whatsapp, telegram, facebook, website, address,
            reviewCount, hours, features,
        };
    });
}

/**
 * Scrape a single city × category combination.
 * Strategy: collect firm links from paginated results, then visit each detail page.
 */
async function scrapeCityCategory(
    browser: Browser,
    city: string,
    category: string,
): Promise<ScrapeResult> {
    const allLeads: RawLead[] = [];
    let pagesScraped = 0;
    const seenHrefs = new Set<string>();

    const page = await browser.newPage();

    try {
        await page.setViewportSize({ width: 1440, height: 900 });

        // Phase 1: Collect all firm links from paginated results
        const allFirmLinks: { name: string; href: string }[] = [];

        for (let pageNum = 1; pageNum <= CONFIG.maxPagesPerCategory; pageNum++) {
            const url = `https://2gis.kz/${city}/search/${encodeURIComponent(category)}/page/${pageNum}`;

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(jitter(1500, 2500));

                const links = await collectFirmLinks(page);
                if (links.length === 0) break; // no more results

                // Dedup across pages AND across categories using firm ID
                let newCount = 0;
                for (const link of links) {
                    const firmId = extractFirmId(link.href);
                    const isDup = firmId ? globalSeenFirmIds.has(firmId) : seenHrefs.has(link.href);
                    if (!isDup) {
                        if (firmId) globalSeenFirmIds.add(firmId);
                        seenHrefs.add(link.href);
                        allFirmLinks.push(link);
                        newCount++;
                    }
                }

                pagesScraped++;
                console.log(`  📄 Page ${pageNum}: ${newCount} new (${allFirmLinks.length} total, ${globalSeenFirmIds.size} global unique)`);

                await page.waitForTimeout(jitter(CONFIG.delayBetweenPagesMin, CONFIG.delayBetweenPagesMax));
            } catch (err: any) {
                console.log(`  ⚠️  Page ${pageNum} error: ${err.message?.substring(0, 60)}`);
                await page.waitForTimeout(3000);
            }
        }

        if (allFirmLinks.length === 0) {
            await page.close();
            return { leads: [], totalFound: 0, pagesScraped, phonesRevealed: 0 };
        }

        // Phase 2: Visit each company's detail page for full contacts
        console.log(`  🔎 Deep scanning ${allFirmLinks.length} companies...`);

        for (let i = 0; i < allFirmLinks.length; i++) {
            const entry = allFirmLinks[i];

            try {
                await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForTimeout(1200);

                // "Show phone" is now handled inside scrapeCompanyDetail

                const detail = await scrapeCompanyDetail(page);

                allLeads.push({
                    companyName: entry.name,
                    phone: detail.phones[0] || undefined,
                    allPhones: detail.phones,
                    email: detail.email || undefined,
                    website: detail.website || undefined,
                    instagram: detail.instagram || undefined,
                    whatsapp: detail.whatsapp || undefined,
                    telegram: detail.telegram || undefined,
                    facebook: detail.facebook || undefined,
                    address: detail.address || undefined,
                    city,
                    category,
                    source: '2gis',
                    sourceUrl: entry.href,
                    reviewCount: detail.reviewCount || 0,
                    hours: detail.hours || undefined,
                    features: detail.features || [],
                    tags: [category, city, '2gis'],
                });

                // Progress indicator every 10 companies
                if ((i + 1) % 10 === 0 || i === allFirmLinks.length - 1) {
                    const withPhone = allLeads.filter(l => l.phone).length;
                    const withEmail = allLeads.filter(l => l.email).length;
                    console.log(`  📊 ${i + 1}/${allFirmLinks.length} scanned | 📞 ${withPhone} phones | 📧 ${withEmail} emails`);
                }

                // Rate limit between detail pages
                await page.waitForTimeout(jitter(CONFIG.delayBetweenClicksMin, CONFIG.delayBetweenClicksMax));

            } catch (err: any) {
                // Company page failed — skip
            }
        }
    } finally {
        await page.close();
    }

    return {
        leads: allLeads,
        totalFound: allLeads.length,
        pagesScraped,
        phonesRevealed: allLeads.filter(l => l.phone).length,
    };
}



// ═══════════════════════════════════════════════════════════════
// ENRICHMENT: Visit company websites for missing contacts
// ═══════════════════════════════════════════════════════════════

async function enrichFromWebsite(page: Page, lead: RawLead): Promise<RawLead> {
    if (!lead.website || lead.website.includes('2gis')) return lead;

    try {
        await page.goto(lead.website, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1000);

        const enriched = await page.evaluate(() => {
            const body = document.body?.textContent || '';
            const html = document.body?.innerHTML || '';

            // Extract emails
            const emails = [...new Set(
                (body.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [])
                    .filter(e => !e.includes('example') && !e.includes('wixpress'))
            )];

            // Extract phones
            const phones: string[] = [];
            const phoneMatches = body.match(/[\+]?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g);
            if (phoneMatches) {
                phoneMatches.forEach(p => {
                    const d = p.replace(/\D/g, '');
                    if (d.length >= 10) phones.push(d);
                });
            }

            // Social links
            const links = Array.from(document.querySelectorAll('a[href]'));
            let instagram = '', telegram = '', whatsapp = '', facebook = '';
            links.forEach(a => {
                const href = (a as HTMLAnchorElement).href;
                if (href.includes('instagram.com') && !instagram) instagram = href;
                if ((href.includes('t.me') || href.includes('telegram')) && !telegram) telegram = href;
                if ((href.includes('wa.me') || href.includes('whatsapp')) && !whatsapp) whatsapp = href;
                if (href.includes('facebook.com') && !facebook) facebook = href;
            });

            return { emails, phones, instagram, telegram, whatsapp, facebook };
        });

        // Merge — only fill missing fields
        if (!lead.email && enriched.emails[0]) lead.email = enriched.emails[0];
        if (enriched.emails.length > 0) lead.allEmails = enriched.emails;
        if (!lead.phone && enriched.phones[0]) lead.phone = enriched.phones[0];
        if (enriched.phones.length > 0) {
            lead.allPhones = [...new Set([...(lead.allPhones || []), ...enriched.phones])];
        }
        if (!lead.instagram && enriched.instagram) lead.instagram = enriched.instagram;
        if (!lead.telegram && enriched.telegram) lead.telegram = enriched.telegram;
        if (!lead.whatsapp && enriched.whatsapp) lead.whatsapp = enriched.whatsapp;
        if (!lead.facebook && enriched.facebook) lead.facebook = enriched.facebook;

    } catch {
        // Website unreachable — skip
    }

    return lead;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const cityFilter = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
    const resumeMode = args.includes('--resume');
    const enrichWebsites = !args.includes('--no-enrich');
    const resetMode = args.includes('--reset');

    console.log('═══════════════════════════════════════════════════════');
    console.log('🏗️  MASS 2GIS SCRAPER — Kazakhstan B2B Database');
    console.log('═══════════════════════════════════════════════════════');

    // Init services
    const checkpoint = new CheckpointManager();
    await checkpoint.connect();
    await leads.connect();

    if (resetMode) {
        await checkpoint.resetAll();
        console.log('🔄 Checkpoints cleared\n');
    }

    // Stage selection: --tier a|b|c|all (default: a)
    const tierArg = args.includes('--tier') ? args[args.indexOf('--tier') + 1]?.toLowerCase() : 'a';
    let categories: string[];
    switch (tierArg) {
        case 'b': categories = [...TIER_A_CATEGORIES, ...TIER_B_CATEGORIES]; break;
        case 'c': categories = [...TIER_A_CATEGORIES, ...TIER_B_CATEGORIES, ...TIER_C_CATEGORIES]; break;
        case 'all': categories = [...TIER_A_CATEGORIES, ...TIER_B_CATEGORIES, ...TIER_C_CATEGORIES]; break;
        default: categories = TIER_A_CATEGORIES;
    }

    const cities = cityFilter ? [cityFilter] : STAGE_1_CITIES;
    const totalJobs = cities.length * categories.length;

    console.log(`\n📍 Cities: ${cities.length} (${cities.join(', ')})`);
    console.log(`📂 Categories: ${categories.length} (Tier ${tierArg.toUpperCase()})`);
    console.log(`📊 Total jobs: ${totalJobs}`);
    console.log(`🔧 Max pages/category: ${CONFIG.maxPagesPerCategory}`);
    console.log(`🌐 Website enrichment: ${enrichWebsites ? 'ON' : 'OFF'}`);
    console.log(`📦 Resume mode: ${resumeMode}\n`);

    // Launch browser
    console.log('🚀 Launching browser...');
    const browser = await chromium.launch({
        headless: false,  // 2GIS blocks headless
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    let totalScraped = 0;
    let totalValid = 0;
    let totalRejected = 0;
    let totalInserted = 0;
    let jobsCompleted = 0;

    try {
        for (const city of cities) {
            console.log(`\n🏙️  === ${city.toUpperCase()} ===`);

            for (const category of categories) {
                // Check if already done (resume mode)
                if (resumeMode) {
                    const done = await checkpoint.isCompleted(city, category);
                    if (done) {
                        jobsCompleted++;
                        continue;
                    }
                }

                console.log(`\n🔍 [${jobsCompleted + 1}/${totalJobs}] ${city} → ${category}`);

                try {
                    // Scrape
                    const result = await scrapeCityCategory(browser, city, category);

                    if (result.leads.length === 0) {
                        console.log(`  ⏭️  No results`);
                        await checkpoint.markCompleted(city, category, 0);
                        jobsCompleted++;
                        continue;
                    }

                    // Enrich from websites (optional)
                    let enrichedLeads = result.leads;
                    if (enrichWebsites) {
                        const enrichPage = await browser.newPage();
                        let enrichCount = 0;
                        for (let i = 0; i < enrichedLeads.length; i++) {
                            const lead = enrichedLeads[i];
                            if (lead.website && !lead.email) {
                                enrichedLeads[i] = await enrichFromWebsite(enrichPage, lead);
                                enrichCount++;
                                // Rate limit website visits
                                await enrichPage.waitForTimeout(1000);
                            }
                        }
                        await enrichPage.close();
                        if (enrichCount > 0) console.log(`  🌐 Enriched ${enrichCount} from websites`);
                    }

                    // Validate — reject empty profiles
                    const valid: RawLead[] = [];
                    let rejected = 0;
                    for (const lead of enrichedLeads) {
                        const result = validateLead(lead);
                        if (result.valid) {
                            valid.push(lead);
                        } else {
                            rejected++;
                        }
                    }

                    totalScraped += enrichedLeads.length;
                    totalValid += valid.length;
                    totalRejected += rejected;

                    console.log(`  ✅ ${valid.length} valid / ❌ ${rejected} rejected (of ${enrichedLeads.length} total)`);

                    // Bulk insert valid leads to Supabase
                    if (valid.length > 0) {
                        const supaLeads = valid.map(raw => ({
                            companyName: raw.companyName,
                            phone: raw.phone || (raw.allPhones?.[0]) || undefined,
                            email: raw.email || (raw.allEmails?.[0]) || undefined,
                            website: raw.website || undefined,
                            source: 'scrape' as const,
                            sourceUrl: raw.sourceUrl,
                            state: 'discovered' as const,
                            tags: raw.tags || [],
                            notes: [
                                raw.address ? `📍 ${raw.address}` : '',
                                raw.category ? `📂 ${raw.category}` : '',
                                raw.instagram ? `📸 ${raw.instagram}` : '',
                                raw.telegram ? `✈️ ${raw.telegram}` : '',
                                raw.whatsapp ? `💬 ${raw.whatsapp}` : '',
                                raw.facebook ? `👤 ${raw.facebook}` : '',
                                (raw as any).reviewCount ? `⭐ ${(raw as any).reviewCount} reviews` : '',
                                (raw as any).hours ? `🕐 ${(raw as any).hours}` : '',
                                (raw as any).features?.length ? `🏷️ ${(raw as any).features.join(', ')}` : '',
                            ].filter(Boolean),
                            contacts: [
                                ...(raw.allPhones || []).map((p, i) => ({
                                    type: 'phone', value: p, role: i === 0 ? 'Primary' : `Phone ${i + 1}`,
                                })),
                                ...(raw.allEmails || []).map((e, i) => ({
                                    type: 'email', value: e, role: i === 0 ? 'Primary' : `Email ${i + 1}`,
                                })),
                            ],
                        }));

                        const { inserted, errors } = await leads.bulkUpsert(supaLeads as any);
                        totalInserted += inserted;
                        console.log(`  💾 Saved ${inserted} to Supabase${errors > 0 ? ` (${errors} errors)` : ''}`);
                    }

                    // Checkpoint
                    await checkpoint.markCompleted(city, category, valid.length);
                    jobsCompleted++;

                } catch (err: any) {
                    console.error(`  ❌ FATAL: ${err.message?.substring(0, 80)}`);
                    // continue with next category
                }
            }
        }
    } finally {
        await browser.close();
    }

    // Final report
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 FINAL REPORT');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Jobs completed:  ${jobsCompleted}/${totalJobs}`);
    console.log(`Total scraped:   ${totalScraped}`);
    console.log(`Valid leads:     ${totalValid}`);
    console.log(`Rejected:        ${totalRejected}`);
    console.log(`Inserted to DB:  ${totalInserted}`);

    const progress = await checkpoint.getProgress();
    if (Object.keys(progress.byCity).length > 0) {
        console.log('\nBy city:');
        Object.entries(progress.byCity).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
            console.log(`  ${c.padEnd(15)} ${n} leads`);
        });
    }

    const stats = await leads.getStats();
    console.log(`\n📈 Total DB leads: ${stats.total}`);

    await checkpoint.disconnect();
    await leads.disconnect();
    console.log('\n✅ Done!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
