/**
 * Yandex Maps Business Scraper
 * Scrapes company listings from Yandex Maps
 * Similar to 2GIS but broader coverage in Russia
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';

interface YandexBusiness {
    name: string;
    category: string;
    address: string;
    phone?: string;
    website?: string;
    hours?: string;
    rating?: number;
}

/**
 * ACTUAL BUYERS: Traditional business locations
 * Non-tech companies that need digital solutions
 */
const SEARCH_CATEGORIES = [
    // Retail/Wholesale (need e-commerce, apps)
    { city: 'almaty', query: 'торговые центры' },
    { city: 'almaty', query: 'оптовые базы' },
    { city: 'almaty', query: 'складские комплексы' },

    // Manufacturing (need automation)
    { city: 'almaty', query: 'производственные компании' },
    { city: 'nur-sultan', query: 'заводы' },

    // Logistics (need tracking systems)
    { city: 'almaty', query: 'логистические центры' },
    { city: 'moscow', query: 'транспортные компании' },

    // Healthcare (need patient systems)
    { city: 'almaty', query: 'частные клиники' },
    { city: 'moscow', query: 'медицинские центры' },
];

export class YandexMapsScraper implements DiscoveryAdapter {
    readonly name = 'yandex_maps';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://yandex.ru/maps';

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[YANDEX_MAPS] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenCompanies = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const search of SEARCH_CATEGORIES) {
                try {
                    const businesses = await this.searchBusinesses(page, search.city, search.query);
                    console.log(`[YANDEX_MAPS] Found ${businesses.length} in ${search.city} for "${search.query}"`);

                    for (const biz of businesses) {
                        const key = biz.name.toLowerCase();
                        if (seenCompanies.has(key)) continue;
                        seenCompanies.add(key);

                        const lead = this.businessToLead(biz, search);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[YANDEX_MAPS] Error in ${search.city}:`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    private async searchBusinesses(
        page: BrowserPage,
        city: string,
        query: string
    ): Promise<YandexBusiness[]> {
        const searchUrl = `${this.baseUrl}/${city}/search/${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle' });

        await page.waitForSelector('[class*="search-snippet"]', { timeout: 10000 }).catch(() => null);

        const businesses = await page.evaluate(() => {
            const snippets = document.querySelectorAll('[class*="search-snippet"]');
            const results: YandexBusiness[] = [];

            snippets.forEach(snippet => {
                try {
                    const nameEl = snippet.querySelector('[class*="business-card-title"]');
                    const categoryEl = snippet.querySelector('[class*="business-card-subtitle"]');
                    const addressEl = snippet.querySelector('[class*="business-card-address"]');
                    const phoneEl = snippet.querySelector('[class*="business-contacts-view__phone"]');
                    const ratingEl = snippet.querySelector('[class*="business-rating"]');

                    if (nameEl) {
                        results.push({
                            name: nameEl.textContent?.trim() || '',
                            category: categoryEl?.textContent?.trim() || '',
                            address: addressEl?.textContent?.trim() || '',
                            phone: phoneEl?.textContent?.trim(),
                            rating: ratingEl ? parseFloat(ratingEl.textContent || '0') : undefined,
                        });
                    }
                } catch (e) {
                    // Skip
                }
            });

            return results.slice(0, 25);
        });

        return businesses;
    }

    private businessToLead(
        biz: YandexBusiness,
        search: { city: string; query: string }
    ): DiscoveredLead | null {
        if (!biz.name) return null;

        return {
            firstName: 'Директор',
            lastName: biz.name,
            companyName: biz.name,
            phone: biz.phone,
            jobTitle: biz.category || 'Руководитель',
            signals: [
                `yandex_${search.query.replace(/\s+/g, '_').slice(0, 15)}`,
                search.city,
                biz.rating && biz.rating >= 4 ? 'high_rated' : '',
            ].filter(Boolean) as string[],
            rawData: {
                source: 'yandex_maps',
                city: search.city,
                query: search.query,
                address: biz.address,
                website: biz.website,
                rating: biz.rating,
            },
        };
    }
}

export const yandexMapsScraper = new YandexMapsScraper();
