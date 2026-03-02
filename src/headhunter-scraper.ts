/**
 * HeadHunter Scraper (hh.ru / hh.kz)
 * Scrapes job postings to find companies that need development help
 * Great for finding leads who are actively hiring developers
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';
import { config } from './config.js';

interface HHVacancy {
    companyName: string;
    companyUrl: string;
    title: string;
    salary?: string;
    location: string;
}

/**
 * ACTUAL BUYERS: Non-tech companies hiring developers
 * If they're hiring devs but aren't IT companies = prime outsourcing prospects
 */
const SIGNAL_SEARCHES = [
    // Legacy system modernization (= need dev agency)
    { query: 'программист 1С', location: 'Алматы' },
    { query: 'разработчик 1С', location: 'Казахстан' },

    // Companies needing web/app presence
    { query: 'разработчик сайта', location: 'Казахстан' },
    { query: 'мобильное приложение разработчик', location: 'Алматы' },

    // Looking for tech leadership = no dev team
    { query: 'ищем CTO', location: 'Казахстан' },
    { query: 'технический директор', location: 'Алматы' },

    // Urgent hiring = struggling, will pay for help
    { query: 'срочно программист', location: 'Казахстан' },
    { query: 'автоматизация бизнес процессов', location: 'Алматы' },
];

export class HeadHunterScraper implements DiscoveryAdapter {
    readonly name = 'headhunter';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://hh.kz'; // Can switch to hh.ru
    private maxVacanciesPerSearch = 20;

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[HH_SCRAPER] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenCompanies = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const search of SIGNAL_SEARCHES) {
                try {
                    const vacancies = await this.searchVacancies(page, search.query, search.location);
                    console.log(`[HH_SCRAPER] Found ${vacancies.length} vacancies for "${search.query}"`);

                    for (const vacancy of vacancies) {
                        // Dedupe by company
                        if (seenCompanies.has(vacancy.companyName)) continue;
                        seenCompanies.add(vacancy.companyName);

                        const lead = this.vacancyToLead(vacancy, search.query);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[HH_SCRAPER] Error searching "${search.query}":`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    /**
     * Search HH for vacancies
     */
    private async searchVacancies(
        page: BrowserPage,
        query: string,
        location: string
    ): Promise<HHVacancy[]> {
        const searchParams = new URLSearchParams({
            text: query,
            area: location ? this.getAreaId(location) : '',
            search_field: 'name',
        });

        const searchUrl = `${this.baseUrl}/search/vacancy?${searchParams}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        // Wait for results
        await page.waitForSelector('.vacancy-serp-item', { timeout: 10000 }).catch(() => null);

        const vacancies = await page.evaluate(() => {
            const items = document.querySelectorAll('.vacancy-serp-item');
            const results: HHVacancy[] = [];

            items.forEach(item => {
                try {
                    const titleEl = item.querySelector('.serp-item__title');
                    const companyEl = item.querySelector('.vacancy-serp-item__meta-info-company a');
                    const salaryEl = item.querySelector('.vacancy-serp-item__sidebar-labels');
                    const locationEl = item.querySelector('[data-qa="vacancy-serp__vacancy-address"]');

                    if (titleEl && companyEl) {
                        results.push({
                            title: titleEl.textContent?.trim() || '',
                            companyName: companyEl.textContent?.trim() || '',
                            companyUrl: (companyEl as HTMLAnchorElement).href || '',
                            salary: salaryEl?.textContent?.trim(),
                            location: locationEl?.textContent?.trim() || '',
                        });
                    }
                } catch (e) {
                    // Skip malformed items
                }
            });

            return results.slice(0, 20);
        });

        return vacancies;
    }

    /**
     * Convert vacancy to lead
     * The "lead" here is the company, not a person
     */
    private vacancyToLead(vacancy: HHVacancy, searchQuery: string): DiscoveredLead | null {
        if (!vacancy.companyName) return null;

        // The lead is the hiring company
        // We'll need to find the decision maker separately
        return {
            firstName: 'HR', // Placeholder - will be enriched
            lastName: vacancy.companyName,
            companyName: vacancy.companyName,
            jobTitle: `Hiring: ${vacancy.title}`,
            signals: [
                `hiring_${searchQuery.replace(/\s+/g, '_')}`,
                vacancy.location,
            ].filter(Boolean) as string[],
            rawData: {
                source: 'headhunter',
                vacancy: vacancy.title,
                companyUrl: vacancy.companyUrl,
                salary: vacancy.salary,
            },
        };
    }

    /**
     * Map location names to HH area IDs
     */
    private getAreaId(location: string): string {
        const areaMap: Record<string, string> = {
            'Казахстан': '40',
            'Алматы': '160',
            'Астана': '159',
            'Москва': '1',
            'Санкт-Петербург': '2',
            'Россия': '113',
        };
        return areaMap[location] || '';
    }
}

// Singleton
export const headhunterScraper = new HeadHunterScraper();
