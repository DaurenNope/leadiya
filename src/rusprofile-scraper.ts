/**
 * Rusprofile.ru Scraper
 * Russian company registry with detailed company info
 * Has director names, revenue, employee counts
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';

interface RusprofileCompany {
    name: string;
    inn: string;  // Tax ID
    ogrn: string; // Registration number
    director: string;
    activity: string;
    employees?: string;
    revenue?: string;
    address: string;
    status: string;
}

/**
 * ACTUAL BUYERS: Traditional businesses needing digital solutions
 * Non-tech companies going digital = they BUY dev services
 */
const SEARCH_TERMS = [
    // Retail chains (need e-commerce, apps)
    'торговая сеть',
    'оптовая компания',
    'дистрибьютор продуктов',

    // Manufacturing (need automation, ERP)
    'производственная компания',
    'завод производство',

    // Logistics (need tracking, apps)
    'транспортная компания',
    'логистика грузоперевозки',

    // Healthcare (need patient systems)
    'сеть клиник',
    'медицинский центр',

    // Real estate (need CRM, platforms)
    'застройщик жилья',
    'агентство недвижимости',

    // HoReCa chains (need POS, delivery)
    'сеть ресторанов',
    'сеть кафе',
];

export class RusprofileScraper implements DiscoveryAdapter {
    readonly name = 'rusprofile';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://www.rusprofile.ru';
    private maxCompaniesPerSearch = 30;

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[RUSPROFILE] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenINNs = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const term of SEARCH_TERMS) {
                try {
                    const companies = await this.searchCompanies(page, term);
                    console.log(`[RUSPROFILE] Found ${companies.length} companies for "${term}"`);

                    for (const company of companies) {
                        if (seenINNs.has(company.inn)) continue;
                        seenINNs.add(company.inn);

                        const lead = this.companyToLead(company, term);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[RUSPROFILE] Error searching "${term}":`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    private async searchCompanies(page: BrowserPage, query: string): Promise<RusprofileCompany[]> {
        const searchUrl = `${this.baseUrl}/search?query=${encodeURIComponent(query)}&type=ul`;
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        await page.waitForSelector('.company-item', { timeout: 10000 }).catch(() => null);

        const companies = await page.evaluate(() => {
            const items = document.querySelectorAll('.company-item');
            const results: RusprofileCompany[] = [];

            items.forEach(item => {
                try {
                    const nameEl = item.querySelector('.company-name');
                    const innEl = item.querySelector('.company-info__text');
                    const directorEl = item.querySelector('.company-info__text--director');
                    const activityEl = item.querySelector('.company-info__text--activity');
                    const addressEl = item.querySelector('.company-info__text--address');
                    const statusEl = item.querySelector('.company-status');

                    if (nameEl) {
                        const innMatch = innEl?.textContent?.match(/ИНН:\s*(\d+)/);
                        const ogrnMatch = innEl?.textContent?.match(/ОГРН:\s*(\d+)/);

                        results.push({
                            name: nameEl.textContent?.trim() || '',
                            inn: innMatch?.[1] || '',
                            ogrn: ogrnMatch?.[1] || '',
                            director: directorEl?.textContent?.trim().replace('Директор: ', '') || '',
                            activity: activityEl?.textContent?.trim() || '',
                            address: addressEl?.textContent?.trim() || '',
                            status: statusEl?.textContent?.trim() || 'Действует',
                        });
                    }
                } catch (e) {
                    // Skip
                }
            });

            return results.slice(0, 30);
        });

        // Filter only active companies
        return companies.filter(c => c.status === 'Действует' || c.status === 'active');
    }

    private companyToLead(company: RusprofileCompany, searchTerm: string): DiscoveredLead | null {
        if (!company.name || !company.inn) return null;

        const directorParts = company.director.split(' ');
        const lastName = directorParts[0] || '';
        const firstName = directorParts.slice(1).join(' ') || 'Руководитель';

        return {
            firstName,
            lastName,
            companyName: company.name,
            jobTitle: 'Генеральный директор',
            signals: [
                `rusprofile_${searchTerm.replace(/\s+/g, '_').slice(0, 20)}`,
                company.employees ? `size_${company.employees}` : '',
            ].filter(Boolean) as string[],
            rawData: {
                source: 'rusprofile',
                inn: company.inn,
                ogrn: company.ogrn,
                activity: company.activity,
                address: company.address,
                revenue: company.revenue,
                employees: company.employees,
            },
        };
    }
}

export const rusprofileScraper = new RusprofileScraper();
