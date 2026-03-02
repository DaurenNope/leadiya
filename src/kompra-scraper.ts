/**
 * Kompra.kz Company Scraper
 * Kazakhstan business registry and company database
 * Finds companies by industry/activity type
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';

interface KompraCompany {
    name: string;
    bin: string;  // Business ID Number (Kazakhstan)
    director: string;
    activity: string;
    employees?: string;
    registered?: string;
    address?: string;
}

/**
 * OKED codes for ACTUAL BUYERS (non-tech companies needing dev services)
 * https://stat.gov.kz/official/industry/192/statistic/7
 */
const TARGET_OKEDS = [
    { code: '46', name: 'Оптовая торговля' },              // Wholesale
    { code: '47', name: 'Розничная торговля' },            // Retail
    { code: '49', name: 'Сухопутный транспорт' },          // Land transport/logistics
    { code: '52', name: 'Складирование и хранение' },      // Warehousing
    { code: '86', name: 'Здравоохранение' },               // Healthcare
    { code: '41', name: 'Строительство' },                 // Construction
    { code: '10', name: 'Производство продуктов питания' }, // Food manufacturing
];

export class KompraScraper implements DiscoveryAdapter {
    readonly name = 'kompra';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://kompra.kz';
    private maxCompaniesPerOked = 50;

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[KOMPRA] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenBINs = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const oked of TARGET_OKEDS) {
                try {
                    const companies = await this.scrapeByOked(page, oked.code);
                    console.log(`[KOMPRA] Found ${companies.length} companies in OKED ${oked.code} (${oked.name})`);

                    for (const company of companies) {
                        // Dedupe by BIN
                        if (seenBINs.has(company.bin)) continue;
                        seenBINs.add(company.bin);

                        const lead = this.companyToLead(company, oked);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[KOMPRA] Error scraping OKED ${oked.code}:`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    private async scrapeByOked(page: BrowserPage, okedCode: string): Promise<KompraCompany[]> {
        // Search by OKED (classification code)
        const searchUrl = `${this.baseUrl}/ru/search?oked=${okedCode}&status=active`;
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        // Wait for search results
        await page.waitForSelector('.search__item', { timeout: 10000 }).catch(() => null);

        const companies = await page.evaluate(() => {
            const items = document.querySelectorAll('.search__item');
            const results: KompraCompany[] = [];

            items.forEach(item => {
                try {
                    // Company name from title
                    const nameEl = item.querySelector('.sr-item__title');
                    const name = nameEl?.textContent?.trim() || '';

                    // Extract labeled fields from .sr-item__layout containers
                    const layouts = item.querySelectorAll('.sr-item__layout');
                    let bin = '';
                    let director = '';
                    let address = '';
                    let activity = '';

                    layouts.forEach(layout => {
                        const label = layout.querySelector('.sr-item__label')?.textContent?.trim() || '';
                        const value = layout.querySelector('.sr-item__value')?.textContent?.trim() || '';
                        if (label.includes('БИН') || label.includes('ИИН')) bin = value;
                        if (label.includes('Руководитель') || label.includes('Директор')) director = value;
                        if (label.includes('адрес')) address = value;
                        if (label.includes('Деятельность') || label.includes('ОКЭД')) activity = value;
                    });

                    // Fallback: regex BIN from full text
                    if (!bin) {
                        const text = item.textContent || '';
                        const binMatch = text.match(/\b\d{12}\b/);
                        if (binMatch) bin = binMatch[0];
                    }

                    if (name && bin) {
                        results.push({
                            name,
                            bin,
                            director: director || '',
                            activity: activity || '',
                            address,
                        });
                    }
                } catch (e) {
                    // Skip malformed items
                }
            });

            return results.slice(0, 50);
        });

        return companies;
    }

    private companyToLead(
        company: KompraCompany,
        oked: { code: string; name: string }
    ): DiscoveredLead | null {
        if (!company.name || !company.bin) return null;

        // Parse director name
        const directorParts = company.director.split(' ');
        const lastName = directorParts[0] || '';
        const firstName = directorParts.slice(1).join(' ') || 'Руководитель';

        return {
            firstName,
            lastName,
            companyName: company.name,
            jobTitle: 'Директор',
            signals: [
                `oked_${oked.code}`,
                company.employees ? `employees_${company.employees}` : '',
                'active_company',
            ].filter(Boolean) as string[],
            rawData: {
                source: 'kompra',
                bin: company.bin,
                activity: company.activity,
                okedCode: oked.code,
                okedName: oked.name,
                employees: company.employees,
            },
        };
    }
}

// Singleton
export const kompraScraper = new KompraScraper();
