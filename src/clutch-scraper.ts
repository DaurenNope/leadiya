/**
 * Clutch.co Agency Scraper
 * Gets: Agency name, website, phone, services
 * Target: Web development and EdTech agencies with budgets
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface AgencyLead {
    name: string;
    website?: string;
    phone?: string;
    email?: string;
    location?: string;
    services?: string[];
    minBudget?: string;
    employees?: string;
}

// Target categories on Clutch
const CATEGORIES = [
    { slug: 'education-software', name: 'Education Software' },
    { slug: 'web-developers', name: 'Web Development' },
    { slug: 'mobile-app-development', name: 'Mobile Apps' },
    { slug: 'artificial-intelligence', name: 'AI/ML' },
];

async function getAgencyLinks(page: Page, category: string): Promise<string[]> {
    const url = `https://clutch.co/developers/${category}?sort_by=field_pp_budget_str`;

    console.log(`\n📍 Category: ${category}`);
    console.log(`   ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Scroll to load more
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(500);
    }

    const links = await page.evaluate(() => {
        const urls: string[] = [];
        document.querySelectorAll('a.company_title, a[class*="company-name"], h3.company_info a').forEach(a => {
            const href = (a as HTMLAnchorElement).href;
            if (href && href.includes('/profile/') && !urls.includes(href)) {
                urls.push(href);
            }
        });

        // Fallback: general profile links
        if (urls.length === 0) {
            document.querySelectorAll('a[href*="/profile/"]').forEach(a => {
                const href = (a as HTMLAnchorElement).href;
                if (href && !urls.includes(href)) {
                    urls.push(href);
                }
            });
        }

        return urls;
    });

    console.log(`   Found ${links.length} agency links`);
    return links.slice(0, 20); // Limit per category
}

async function extractAgencyDetails(page: Page, url: string): Promise<AgencyLead | null> {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);

        const details = await page.evaluate(() => {
            const result: any = {};

            // Company name
            const h1 = document.querySelector('h1');
            result.name = h1?.textContent?.trim() || '';

            // Website link
            const websiteLink = document.querySelector('a[class*="website"], a[rel="nofollow noopener"][href^="http"]');
            if (websiteLink) {
                const href = (websiteLink as HTMLAnchorElement).href;
                if (!href.includes('clutch.co')) {
                    result.website = href;
                }
            }

            // Phone
            const phoneLink = document.querySelector('a[href^="tel:"]');
            if (phoneLink) {
                result.phone = phoneLink.getAttribute('href')?.replace('tel:', '').trim();
            }

            // Location
            const locationEl = document.querySelector('[class*="location"], .locality');
            if (locationEl) {
                result.location = locationEl.textContent?.trim();
            }

            // Min budget
            const budgetEl = document.querySelector('[class*="budget"], [class*="min-project"]');
            if (budgetEl) {
                const text = budgetEl.textContent || '';
                const match = text.match(/\$[\d,]+/);
                if (match) {
                    result.minBudget = match[0];
                }
            }

            // Employees
            const employeesEl = document.querySelector('[class*="employees"]');
            if (employeesEl) {
                result.employees = employeesEl.textContent?.trim();
            }

            // Services
            const serviceEls = document.querySelectorAll('[class*="service-line"] a, .focus-area a');
            result.services = Array.from(serviceEls).map(el => el.textContent?.trim()).filter(Boolean).slice(0, 5);

            return result;
        });

        if (details.name && details.name.length > 2) {
            return {
                name: details.name,
                website: details.website,
                phone: details.phone,
                location: details.location,
                minBudget: details.minBudget,
                employees: details.employees,
                services: details.services,
            };
        }
    } catch (err) {
        // Skip failed pages
    }

    return null;
}

async function main() {
    console.log('🏢 Clutch.co Agency Scraper\n');
    console.log('🎯 Targeting: EdTech & Web Development Agencies\n');

    await leads.connect();

    const browser: Browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    const allAgencies: AgencyLead[] = [];
    const seen = new Set<string>();

    for (const category of CATEGORIES) {
        const links = await getAgencyLinks(page, category.slug);

        for (const link of links) {
            const agency = await extractAgencyDetails(page, link);

            if (agency && !seen.has(agency.name.toLowerCase())) {
                seen.add(agency.name.toLowerCase());
                allAgencies.push(agency);

                const hasContact = agency.phone || agency.website;
                console.log(`   ${hasContact ? '✓' : '○'} ${agency.name.substring(0, 35)} ${agency.location || ''}`);
            }

            await page.waitForTimeout(500);
        }

        await page.waitForTimeout(1000);
    }

    // Stats
    const withPhone = allAgencies.filter(a => a.phone).length;
    const withWebsite = allAgencies.filter(a => a.website).length;

    console.log('\n' + '='.repeat(50));
    console.log('📊 RESULTS');
    console.log('='.repeat(50));
    console.log(`Total agencies: ${allAgencies.length}`);
    console.log(`With phone: ${withPhone} (${Math.round(withPhone / allAgencies.length * 100) || 0}%)`);
    console.log(`With website: ${withWebsite} (${Math.round(withWebsite / allAgencies.length * 100) || 0}%)`);

    // Save to Redis
    console.log('\n💾 Saving to database...');
    for (const agency of allAgencies) {
        await leads.create({
            firstName: 'Business',
            lastName: 'Development',
            companyName: agency.name,
            phone: agency.phone,
            website: agency.website,
            email: agency.email,
            source: 'clutch' as any,
            state: 'discovered',
            signalSummary: `Agency: ${agency.services?.slice(0, 3).join(', ') || 'Software'}`,
            tags: ['agency', 'software', ...(agency.services?.slice(0, 3) || [])],
            notes: [
                `Location: ${agency.location || 'N/A'}`,
                `Min Budget: ${agency.minBudget || 'N/A'}`,
                `Size: ${agency.employees || 'N/A'}`,
            ],
        });
    }

    const stats = await leads.getStats();
    console.log(`\n✅ Saved ${allAgencies.length} agency leads`);
    console.log(`📈 Total in DB: ${stats.total}`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
