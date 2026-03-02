/**
 * GreatSchools.org Education Scraper
 * No anti-bot protection - accessible!
 * Gets: School name, phone, address, website
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface SchoolLead {
    name: string;
    phone?: string;
    address?: string;
    website?: string;
    city: string;
    state: string;
    type: string;
}

// Target cities with good private school markets
const TARGETS = [
    { state: 'NY', city: 'New York' },
    { state: 'CA', city: 'Los Angeles' },
    { state: 'CA', city: 'San Francisco' },
    { state: 'TX', city: 'Houston' },
    { state: 'TX', city: 'Dallas' },
    { state: 'FL', city: 'Miami' },
    { state: 'MA', city: 'Boston' },
    { state: 'IL', city: 'Chicago' },
    { state: 'WA', city: 'Seattle' },
    { state: 'CO', city: 'Denver' },
];

async function getSchoolLinks(page: Page, state: string, city: string): Promise<string[]> {
    const searchUrl = `https://www.greatschools.org/search/search.page?q=private%20schools&state=${state}&city=${encodeURIComponent(city)}`;

    console.log(`\n📍 ${city}, ${state}`);
    console.log(`   ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load more results
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(500);
    }

    const links = await page.evaluate(() => {
        const anchors = document.querySelectorAll('a.name, a[class*="school-name"], .school-list a[href*="/schools/"]');
        const urls: string[] = [];
        anchors.forEach(a => {
            const href = (a as HTMLAnchorElement).href;
            if (href && href.includes('greatschools.org') && !urls.includes(href)) {
                urls.push(href);
            }
        });
        return urls;
    });

    // If no links found with .name, try broader selector
    if (links.length === 0) {
        const broadLinks = await page.evaluate(() => {
            const urls: string[] = [];
            document.querySelectorAll('a').forEach(a => {
                const href = a.href;
                // Match school detail page pattern: /state/city/id-name/
                if (href.match(/greatschools\.org\/[a-z-]+\/[a-z-]+\/\d+-[a-zA-Z-]+\/?$/)) {
                    if (!urls.includes(href)) {
                        urls.push(href);
                    }
                }
            });
            return urls;
        });
        return broadLinks.slice(0, 15);
    }

    console.log(`   Found ${links.length} school links`);
    return links.slice(0, 15); // Limit per city
}

async function extractSchoolDetails(page: Page, url: string): Promise<SchoolLead | null> {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);

        const details = await page.evaluate(() => {
            const result: any = {};

            // School name from h1
            const h1 = document.querySelector('h1');
            result.name = h1?.textContent?.trim() || '';

            // Phone - look for tel: links
            const phoneLink = document.querySelector('a[href^="tel:"]');
            if (phoneLink) {
                result.phone = phoneLink.getAttribute('href')?.replace('tel:', '').trim();
            }

            // Also search in text
            if (!result.phone) {
                const text = document.body.innerText;
                const phoneMatch = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
                if (phoneMatch) {
                    result.phone = phoneMatch[0];
                }
            }

            // Address - look in Neighborhood section or general
            const addressEl = document.querySelector('[class*="address"], [itemprop="address"]');
            if (addressEl) {
                result.address = addressEl.textContent?.trim();
            }

            // Website - look for external links
            const websiteLinks = document.querySelectorAll('a[href^="http"]');
            websiteLinks.forEach(link => {
                const href = (link as HTMLAnchorElement).href;
                if (!href.includes('greatschools.org') &&
                    !href.includes('facebook.com') &&
                    !href.includes('twitter.com') &&
                    !href.includes('google.com')) {
                    if (!result.website) {
                        result.website = href;
                    }
                }
            });

            return result;
        });

        if (details.name && details.name.length > 2) {
            return {
                name: details.name,
                phone: details.phone,
                address: details.address,
                website: details.website,
                city: '',
                state: '',
                type: 'private'
            };
        }
    } catch (err) {
        // Skip failed pages
    }

    return null;
}

async function main() {
    console.log('🎓 GreatSchools.org Education Scraper\n');
    console.log('🎯 Targeting: Private Schools in Major US Cities\n');

    await leads.connect();

    const browser: Browser = await chromium.launch({
        headless: true, // Can run headless - no anti-bot!
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    const allSchools: SchoolLead[] = [];
    const seen = new Set<string>();

    for (const target of TARGETS) {
        const links = await getSchoolLinks(page, target.state, target.city);

        for (const link of links) {
            const school = await extractSchoolDetails(page, link);

            if (school && !seen.has(school.name.toLowerCase())) {
                seen.add(school.name.toLowerCase());
                school.city = target.city;
                school.state = target.state;
                allSchools.push(school);

                const hasContact = school.phone || school.website;
                console.log(`   ${hasContact ? '✓' : '○'} ${school.name.substring(0, 40)} ${school.phone || ''}`);
            }

            await page.waitForTimeout(500);
        }

        await page.waitForTimeout(1000);
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
            source: 'greatschools' as any,
            state: 'discovered',
            signalSummary: `education: ${school.city}, ${school.state}`,
            tags: ['education', 'private_school', school.state],
            notes: [
                `City: ${school.city}`,
                `State: ${school.state}`,
                `Address: ${school.address || 'N/A'}`
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
