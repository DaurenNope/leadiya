/**
 * Niche.com Education Scraper
 * Targets K-12 schools, private schools, and colleges in the US
 * Gets: School name, type, address, phone, website, key contacts
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface SchoolLead {
    name: string;
    type: string; // private, public, charter, college
    address: string;
    phone?: string;
    website?: string;
    rating?: string;
    city: string;
    state: string;
}

// Target states with good private school markets
const TARGET_STATES = ['california', 'new-york', 'texas', 'florida', 'massachusetts'];

// School types to target  
const SCHOOL_TYPES = [
    'private-schools',
    'private-high-schools',
    'private-elementary-schools',
    'colleges'
];

async function extractSchoolsFromList(page: Page): Promise<SchoolLead[]> {
    return await page.evaluate(() => {
        const schools: any[] = [];

        // Niche lists schools in cards
        const cards = document.querySelectorAll('[data-testid="search-result"],.search-result,.school-card');

        cards.forEach(card => {
            const nameEl = card.querySelector('h2, .name, [class*="title"]');
            const addressEl = card.querySelector('[class*="address"], [class*="location"]');
            const ratingEl = card.querySelector('[class*="grade"], [class*="rating"]');

            if (nameEl) {
                schools.push({
                    name: nameEl.textContent?.trim() || '',
                    address: addressEl?.textContent?.trim() || '',
                    rating: ratingEl?.textContent?.trim() || '',
                });
            }
        });

        return schools;
    });
}

async function extractSchoolDetails(page: Page): Promise<Partial<SchoolLead>> {
    return await page.evaluate(() => {
        const result: any = {};

        const text = document.body.innerText;

        // Phone number
        const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
        if (phoneMatch) {
            result.phone = phoneMatch[0];
        }

        // Website
        const websiteLink = document.querySelector('a[href*="website"], a[class*="website"]');
        if (websiteLink) {
            result.website = (websiteLink as HTMLAnchorElement).href;
        }

        // Try to find website from text
        const urlMatch = text.match(/(?:www\.)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (urlMatch && !result.website) {
            result.website = 'https://' + urlMatch[0];
        }

        // Address
        const addressEl = document.querySelector('[class*="address"], [itemprop="address"]');
        if (addressEl) {
            result.address = addressEl.textContent?.trim();
        }

        return result;
    });
}

async function scrapeNicheSchools(
    page: Page,
    state: string,
    schoolType: string
): Promise<SchoolLead[]> {
    const url = `https://www.niche.com/k12/${schoolType}/s/${state}/`;
    console.log(`\n📚 Scraping: ${state} / ${schoolType}`);
    console.log(`   ${url}`);

    const results: SchoolLead[] = [];

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Scroll to load more
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 800));
            await page.waitForTimeout(500);
        }

        // Get all school links
        const schoolLinks = await page.evaluate(() => {
            const links: string[] = [];
            const anchors = document.querySelectorAll('a[href*="/k12/"]');
            anchors.forEach(a => {
                const href = (a as HTMLAnchorElement).href;
                // Only school detail pages (not list pages)
                if (href.includes('/k12/') && !href.includes('/search/') &&
                    !href.includes('/best/') && href.split('/').length > 5) {
                    if (!links.includes(href)) {
                        links.push(href);
                    }
                }
            });
            return links.slice(0, 20); // Limit per category
        });

        console.log(`   Found ${schoolLinks.length} school links`);

        // Visit each school page
        for (const link of schoolLinks) {
            try {
                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(1500);

                const details = await extractSchoolDetails(page);

                // Get school name from page
                const name = await page.evaluate(() => {
                    const h1 = document.querySelector('h1');
                    return h1?.textContent?.trim() || '';
                });

                if (name && name.length > 3) {
                    const school: SchoolLead = {
                        name,
                        type: schoolType,
                        address: details.address || '',
                        phone: details.phone,
                        website: details.website,
                        city: '',
                        state: state.replace('-', ' ')
                    };

                    results.push(school);

                    const hasContact = school.phone || school.website;
                    console.log(`   ${hasContact ? '✓' : '○'} ${name.substring(0, 40)} ${school.phone || ''}`);
                }
            } catch (err) {
                // Skip failed pages
            }
        }

    } catch (error) {
        console.log(`   ✗ Error: ${error}`);
    }

    return results;
}

async function main() {
    console.log('🎓 Niche.com Education Scraper\n');
    console.log('🎯 Targeting: Private Schools & Colleges in US\n');

    await leads.connect();

    const browser: Browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    const allSchools: SchoolLead[] = [];
    const seen = new Set<string>();

    for (const state of TARGET_STATES) {
        for (const schoolType of SCHOOL_TYPES) {
            const schools = await scrapeNicheSchools(page, state, schoolType);

            for (const school of schools) {
                const key = school.name.toLowerCase();
                if (!seen.has(key)) {
                    seen.add(key);
                    allSchools.push(school);
                }
            }

            await page.waitForTimeout(2000);
        }
    }

    // Stats
    const withPhone = allSchools.filter(s => s.phone).length;
    const withWebsite = allSchools.filter(s => s.website).length;

    console.log('\n' + '='.repeat(50));
    console.log('📊 RESULTS');
    console.log('='.repeat(50));
    console.log(`Total schools: ${allSchools.length}`);
    console.log(`With phone: ${withPhone} (${Math.round(withPhone / allSchools.length * 100) || 0}%)`);
    console.log(`With website: ${withWebsite} (${Math.round(withWebsite / allSchools.length * 100) || 0}%)`);

    // Save to Redis
    console.log('\n💾 Saving to database...');
    for (const school of allSchools) {
        await leads.create({
            firstName: 'Admissions',
            lastName: 'Office',
            companyName: school.name,
            phone: school.phone,
            website: school.website,
            source: 'niche' as any,
            state: 'discovered',
            signalSummary: `education: ${school.state}`,
            tags: ['education', school.type, school.state],
            notes: [
                `Type: ${school.type}`,
                `Address: ${school.address}`,
                `Rating: ${school.rating || 'N/A'}`
            ],
        });
    }

    const stats = await leads.getStats();
    console.log(`\n✅ Saved ${allSchools.length} education leads`);
    console.log(`📈 Total in DB: ${stats.total}`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
