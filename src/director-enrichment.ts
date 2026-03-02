/**
 * Director Enrichment from Free KZ Sources
 * Sources: kgd.gov.kz (tax portal), stat.gov.kz (statistics)
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface DirectorInfo {
    name?: string;
    bin?: string;
    address?: string;
}

/**
 * Search kgd.gov.kz (Комитет государственных доходов) for company info
 */
async function searchKGD(page: Page, companyName: string): Promise<DirectorInfo> {
    try {
        // Clean company name
        const searchName = companyName
            .replace(/ТОО|АО|ИП/gi, '')
            .replace(/[«»"']/g, '')
            .trim();

        // KGD search page
        const url = `https://kgd.gov.kz/ru/services/taxpayer_search`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);

        // Look for search input
        const searchInput = await page.$('input[type="text"], input[name*="search"], input[name*="bin"]');
        if (searchInput) {
            await searchInput.fill(searchName);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
        }

        // Extract info from results
        const result = await page.evaluate(() => {
            const text = document.body.innerText;

            // Look for director info
            const directorPatterns = [
                /(?:Руководитель|Директор|Первый руководитель)[\s:]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/,
            ];

            // Look for BIN
            const binMatch = text.match(/БИН[\s:]+(\d{12})/);

            let directorName: string | undefined;
            for (const pattern of directorPatterns) {
                const match = text.match(pattern);
                if (match) {
                    directorName = match[1];
                    break;
                }
            }

            return {
                name: directorName,
                bin: binMatch ? binMatch[1] : undefined,
            };
        });

        return result;

    } catch (error) {
        return {};
    }
}

/**
 * Search stat.gov.kz (statistics portal) for company info
 */
async function searchStatGov(page: Page, companyName: string): Promise<DirectorInfo> {
    try {
        const searchName = companyName
            .replace(/ТОО|АО|ИП/gi, '')
            .replace(/[«»"']/g, '')
            .trim();

        // Stat.gov search for legal entities
        const url = `https://stat.gov.kz/ru/juridical/search/?name=${encodeURIComponent(searchName)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);

        const result = await page.evaluate(() => {
            const text = document.body.innerText;

            // Extract director if shown
            const directorMatch = text.match(/(?:Руководитель|Директор)[\s:]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/);
            const binMatch = text.match(/(\d{12})/);
            const addressMatch = text.match(/(?:Адрес|Юр\.?\s*адрес|Местонахождение)[\s:]+([^,\n]+)/);

            return {
                name: directorMatch ? directorMatch[1] : undefined,
                bin: binMatch ? binMatch[0] : undefined,
                address: addressMatch ? addressMatch[1] : undefined,
            };
        });

        return result;

    } catch (error) {
        return {};
    }
}

/**
 * Try government portal egov.kz for company search
 */
async function searchEGov(page: Page, companyName: string): Promise<DirectorInfo> {
    try {
        const searchName = companyName
            .replace(/ТОО|АО|ИП/gi, '')
            .replace(/[«»"']/g, '')
            .trim()
            .split(' ')
            .slice(0, 2)
            .join(' ');

        // eGov legal entity search
        const url = `https://egov.kz/cms/ru/services/business_reg_serv/reg_legal_entity`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(2000);

        // Try to find and use search
        const inputs = await page.$$('input[type="text"]');
        for (const input of inputs) {
            try {
                await input.fill(searchName);
                await page.waitForTimeout(500);
            } catch { }
        }

        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        const result = await page.evaluate(() => {
            const text = document.body.innerText;

            const directorMatch = text.match(/(?:Первый руководитель|Руководитель|Директор)[\s:–—-]+([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/);

            return {
                name: directorMatch ? directorMatch[1] : undefined,
            };
        });

        return result;

    } catch (error) {
        return {};
    }
}

async function main() {
    console.log('🏛️  Director Enrichment from Government Portals\n');
    console.log('Sources: KGD.gov.kz, Stat.gov.kz, eGov.kz\n');

    await leads.connect();
    const allLeads = await leads.getAll();

    // Focus on leads without director names
    const needsEnrichment = allLeads.filter(l =>
        l.firstName === 'Директор' || !l.firstName
    );

    console.log(`📊 ${needsEnrichment.length} leads need director names\n`);

    const browser: Browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        locale: 'ru-RU'
    });
    const page = await context.newPage();

    let enriched = 0;
    let foundDirector = 0;

    // Process first 20 leads as test
    const toProcess = needsEnrichment.slice(0, 20);

    for (const lead of toProcess) {
        console.log(`\n→ ${lead.companyName?.substring(0, 40)}`);

        let directorInfo: DirectorInfo = {};

        // Try stat.gov.kz first (most reliable for company data)
        console.log(`   📊 Trying stat.gov.kz...`);
        directorInfo = await searchStatGov(page, lead.companyName || '');

        if (!directorInfo.name) {
            // Try KGD
            console.log(`   📋 Trying kgd.gov.kz...`);
            directorInfo = await searchKGD(page, lead.companyName || '');
        }

        if (directorInfo.name) {
            console.log(`   ✓ Director: ${directorInfo.name}`);

            const parts = directorInfo.name.split(/\s+/);
            await leads.update(lead.id, {
                firstName: parts[1] || parts[0],
                lastName: parts[0],
            });

            foundDirector++;
            enriched++;
        } else {
            console.log(`   ○ No director found`);
        }

        await page.waitForTimeout(2000);
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 DIRECTOR ENRICHMENT RESULTS`);
    console.log(`${'='.repeat(50)}`);
    console.log(`Leads processed:    ${toProcess.length}`);
    console.log(`Directors found:    ${foundDirector}`);
    console.log(`Success rate:       ${Math.round(foundDirector / toProcess.length * 100)}%`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
