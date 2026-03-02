/**
 * Kompra.kz Scraper - Kazakhstan company registry
 * Gets director names and company details
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface KompraCompany {
    name: string;
    bin: string;           // Business ID number
    director: string;
    address: string;
    phone?: string;
    activity: string;
    vertical: string;
}

const SEARCH_QUERIES = [
    // Education
    { query: 'университет', vertical: 'education' },
    { query: 'образование', vertical: 'education' },
    { query: 'школа частная', vertical: 'education' },
    { query: 'колледж', vertical: 'education' },
    { query: 'учебный центр', vertical: 'education' },

    // Logistics  
    { query: 'логистика', vertical: 'logistics' },
    { query: 'транспорт', vertical: 'logistics' },
    { query: 'грузоперевозки', vertical: 'logistics' },
    { query: 'экспедиция', vertical: 'logistics' },

    // Real Estate
    { query: 'застройщик', vertical: 'realestate' },
    { query: 'строительство', vertical: 'realestate' },
    { query: 'недвижимость', vertical: 'realestate' },
    { query: 'девелопмент', vertical: 'realestate' },
];

async function searchKompra(
    page: Page,
    query: string,
    vertical: string
): Promise<KompraCompany[]> {
    const searchUrl = `https://kompra.kz/search?q=${encodeURIComponent(query)}`;
    console.log(`  → ${searchUrl}`);

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Extract company data from search results
        const companies = await page.evaluate((vertical) => {
            const results: KompraCompany[] = [];

            // Kompra typically has cards with company info
            const cards = document.querySelectorAll('.company-card, .search-result, [class*="result"], article, .card');

            cards.forEach(card => {
                const text = card.textContent || '';

                // Look for BIN pattern (12 digits)
                const binMatch = text.match(/\b\d{12}\b/);

                // Look for director/руководитель
                const directorMatch = text.match(/(?:Руководитель|Директор|ИП)[\s:]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/);

                // Company name - usually in h2, h3, or strong
                const nameEl = card.querySelector('h2, h3, h4, .company-name, [class*="title"], strong');
                const name = nameEl?.textContent?.trim();

                if (name && name.length > 5 && name.length < 150) {
                    results.push({
                        name: name,
                        bin: binMatch ? binMatch[0] : '',
                        director: directorMatch ? directorMatch[1] : '',
                        address: '',
                        activity: vertical,
                        vertical
                    });
                }
            });

            // If no cards found, try extracting from table rows
            if (results.length === 0) {
                const rows = document.querySelectorAll('tr, .list-item');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, div');
                    if (cells.length >= 2) {
                        const text = row.textContent || '';
                        const binMatch = text.match(/\b\d{12}\b/);
                        const name = cells[0]?.textContent?.trim() || cells[1]?.textContent?.trim();

                        if (name && name.length > 5 && !name.match(/^\d+$/)) {
                            results.push({
                                name,
                                bin: binMatch ? binMatch[0] : '',
                                director: '',
                                address: '',
                                activity: vertical,
                                vertical
                            });
                        }
                    }
                });
            }

            return results.slice(0, 20);
        }, vertical);

        return companies;
    } catch (error) {
        console.log(`    ✗ Error: ${error}`);
        return [];
    }
}

async function main() {
    console.log('🏛️  Kompra.kz Scraper - Company Registry\n');
    console.log('Targets: Education, Logistics, Real Estate\n');

    await leads.connect();
    console.log('✅ Redis connected\n');

    const browser: Browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        locale: 'ru-RU'
    });
    const page = await context.newPage();
    console.log('🌐 Browser ready\n');

    const allLeads: KompraCompany[] = [];
    const seenCompanies = new Set<string>();

    for (const search of SEARCH_QUERIES) {
        console.log(`\n📂 Searching: "${search.query}" [${search.vertical}]`);

        const companies = await searchKompra(page, search.query, search.vertical);
        console.log(`   Found: ${companies.length}`);

        for (const company of companies) {
            const key = company.name.toLowerCase();
            if (!seenCompanies.has(key)) {
                seenCompanies.add(key);
                allLeads.push(company);
                if (company.director) {
                    console.log(`     → ${company.name} (${company.director})`);
                }
            }
        }

        await page.waitForTimeout(2000);
    }

    console.log(`\n📊 Total unique leads: ${allLeads.length}\n`);

    // Save to Redis
    let saved = 0;
    const existing = await leads.getAll();
    const existingNames = new Set(existing.map(e => e.companyName?.toLowerCase()));

    for (const company of allLeads) {
        if (!existingNames.has(company.name.toLowerCase())) {
            await leads.create({
                firstName: company.director || 'Директор',
                lastName: company.name,
                companyName: company.name,
                phone: company.phone,
                source: 'scrape',
                state: 'discovered',
                signalSummary: `${company.vertical}: ${company.activity}`,
                tags: [company.vertical, 'kompra', company.bin].filter(Boolean),
                notes: company.bin ? [`БИН: ${company.bin}`] : [],
            });
            saved++;
            console.log(`  ✓ [${company.vertical.toUpperCase()}] ${company.name}`);
        }
    }

    console.log(`\n✅ Saved ${saved} new leads`);

    const stats = await leads.getStats();
    console.log(`📈 Total in DB: ${stats.total}\n`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
