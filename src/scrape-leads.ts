/**
 * 2GIS Contact Scraper
 * Clicks into each company page to extract full contact details
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface CompanyContact {
    name: string;
    phone?: string;
    email?: string;
    contactPerson?: string;
    website?: string;
    address?: string;
    vertical: string;
    city: string;
}

// All major Kazakhstan cities
const KZ_CITIES = ['almaty', 'astana', 'shymkent', 'karaganda', 'aktobe', 'aktau'];

// Build targets for all cities
const TARGET_CATEGORIES = KZ_CITIES.flatMap(city => [
    // EDUCATION
    { city, query: 'университет', vertical: 'education' },
    { city, query: 'частная школа', vertical: 'education' },
    { city, query: 'колледж', vertical: 'education' },
    // LOGISTICS
    { city, query: 'логистическая компания', vertical: 'logistics' },
    { city, query: 'грузоперевозки', vertical: 'logistics' },
    // REAL ESTATE  
    { city, query: 'застройщик', vertical: 'realestate' },
    { city, query: 'агентство недвижимости', vertical: 'realestate' },
]);

async function extractCompanyDetails(page: Page): Promise<Partial<CompanyContact>> {
    return await page.evaluate(() => {
        const result: any = {};

        // Get all text content
        const text = document.body.innerText;

        // Phone: Look for +7 patterns
        const phonePatterns = [
            /\+7\s*\(?[0-9]{3}\)?\s*[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2}/g,
            /\+7[0-9]{10}/g,
            /8\s*\(?[0-9]{3}\)?\s*[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2}/g,
        ];

        for (const pattern of phonePatterns) {
            const matches = text.match(pattern);
            if (matches && matches.length > 0) {
                // Clean and format phone
                let phone = matches[0].replace(/[\s()-]/g, '');
                if (phone.startsWith('8')) phone = '+7' + phone.slice(1);
                result.phone = phone;
                break;
            }
        }

        // Email: Look for email patterns
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
            result.email = emailMatch[0].toLowerCase();
        }

        // Website: Look for URLs
        const websiteMatch = text.match(/(?:www\.|https?:\/\/)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (websiteMatch) {
            let site = websiteMatch[0];
            if (!site.startsWith('http')) site = 'https://' + site;
            result.website = site;
        }

        // Company name from title/header
        const nameEl = document.querySelector('h1, [class*="cardTitle"], [class*="name"]');
        if (nameEl) {
            result.name = nameEl.textContent?.trim();
        }

        // Address from visible text
        const addressPatterns = [
            /(?:ул\.|улица|пр\.|проспект)\s*[А-Яа-яЁё\s\d,-]+/,
            /(?:Алматы|Астана),\s*[А-Яа-яЁё\s\d,-]+/,
        ];
        for (const pattern of addressPatterns) {
            const match = text.match(pattern);
            if (match) {
                result.address = match[0].trim();
                break;
            }
        }

        return result;
    });
}

async function scrapeWithContacts(
    page: Page,
    city: string,
    query: string,
    vertical: string
): Promise<CompanyContact[]> {
    const searchUrl = `https://2gis.kz/${city}/search/${encodeURIComponent(query)}`;
    console.log(`→ ${searchUrl}`);

    const results: CompanyContact[] = [];

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Scroll to load more results
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.scrollBy(0, 600));
            await page.waitForTimeout(500);
        }

        // Find all company links
        const companyLinks = await page.evaluate(() => {
            const links: string[] = [];

            // 2GIS company cards have links to /firm/... pages
            const anchors = document.querySelectorAll('a[href*="/firm/"]');
            anchors.forEach(a => {
                const href = (a as HTMLAnchorElement).href;
                if (href && !links.includes(href)) {
                    links.push(href);
                }
            });

            return links.slice(0, 15); // Limit to 15 per category
        });

        console.log(`   Found ${companyLinks.length} company links`);

        // Visit each company page
        for (const link of companyLinks) {
            try {
                await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForTimeout(2000);

                const details = await extractCompanyDetails(page);

                if (details.name && details.name.length > 3) {
                    // Clean name
                    let name = details.name
                        .replace(/[\u200B-\u200D\uFEFF]/g, '')
                        .replace(/Реклама/gi, '')
                        .trim();

                    // Skip garbage
                    if (name.includes('2ГИС') || name.length > 80) continue;

                    const company: CompanyContact = {
                        name,
                        phone: details.phone,
                        email: details.email,
                        website: details.website,
                        address: details.address,
                        vertical,
                        city
                    };

                    results.push(company);

                    const hasContact = company.phone || company.email;
                    console.log(`   ${hasContact ? '✓' : '○'} ${name.substring(0, 40)} ${company.phone || ''}`);
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
    console.log('🚀 2GIS Contact Scraper\n');
    console.log('Extracting: Phone, Email, Website\n');

    await leads.connect();

    // Clear old data
    console.log('🗑️  Clearing old leads...');
    const existing = await leads.getAll();
    for (const lead of existing) {
        if (lead.source === 'scrape') {
            await leads.delete(lead.id);
        }
    }
    console.log('   Done\n');

    const browser: Browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        locale: 'ru-RU'
    });
    const page = await context.newPage();

    const allCompanies: CompanyContact[] = [];
    const seen = new Set<string>();

    for (const target of TARGET_CATEGORIES) {
        console.log(`\n📂 ${target.city.toUpperCase()} / ${target.query} [${target.vertical}]`);

        const companies = await scrapeWithContacts(page, target.city, target.query, target.vertical);

        for (const company of companies) {
            const key = company.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                allCompanies.push(company);
            }
        }

        await page.waitForTimeout(2000);
    }

    // Stats
    const withPhone = allCompanies.filter(c => c.phone).length;
    const withEmail = allCompanies.filter(c => c.email).length;

    console.log(`\n📊 RESULTS`);
    console.log(`   Total: ${allCompanies.length}`);
    console.log(`   With phone: ${withPhone} (${Math.round(withPhone / allCompanies.length * 100)}%)`);
    console.log(`   With email: ${withEmail} (${Math.round(withEmail / allCompanies.length * 100)}%)`);

    // Save to Redis
    console.log('\n💾 Saving to database...');
    for (const company of allCompanies) {
        await leads.create({
            firstName: 'Директор',
            lastName: company.name,
            companyName: company.name,
            phone: company.phone,
            whatsappNumber: company.phone, // Same for WhatsApp
            email: company.email,
            website: company.website,
            source: 'scrape',
            state: 'discovered',
            signalSummary: `${company.vertical}: ${company.city}`,
            tags: [company.vertical, company.city],
            notes: company.address ? [company.address] : [],
        });
    }

    const stats = await leads.getStats();
    console.log(`\n✅ Saved ${allCompanies.length} leads`);
    console.log(`📈 Total in DB: ${stats.total}`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
