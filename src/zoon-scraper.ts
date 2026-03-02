/**
 * Zoon.ru Scraper
 * Russian business directory with reviews
 * Good for finding service companies
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';

interface ZoonCompany {
    name: string;
    category: string;
    address: string;
    phone?: string;
    website?: string;
    rating?: number;
    reviewCount?: number;
}

const SEARCH_CATEGORIES = [
    { city: 'almaty', category: 'it_kompanii' },
    { city: 'almaty', category: 'veb_studii' },
    { city: 'almaty', category: 'reklamnye_agentstva' },
    { city: 'moscow', category: 'it_kompanii' },
    { city: 'moscow', category: 'razrabotka_sajtov' },
    { city: 'spb', category: 'it_kompanii' },
];

export class ZoonScraper implements DiscoveryAdapter {
    readonly name = 'zoon';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://zoon.ru';

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[ZOON] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenCompanies = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const search of SEARCH_CATEGORIES) {
                try {
                    const companies = await this.scrapeCategory(page, search.city, search.category);
                    console.log(`[ZOON] Found ${companies.length} in ${search.city}/${search.category}`);

                    for (const company of companies) {
                        const key = company.name.toLowerCase();
                        if (seenCompanies.has(key)) continue;
                        seenCompanies.add(key);

                        const lead = this.companyToLead(company, search);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[ZOON] Error in ${search.city}/${search.category}:`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    private async scrapeCategory(
        page: BrowserPage,
        city: string,
        category: string
    ): Promise<ZoonCompany[]> {
        const url = `${this.baseUrl}/${city}/${category}/`;
        await page.goto(url, { waitUntil: 'networkidle' });

        await page.waitForSelector('.minicard-item', { timeout: 10000 }).catch(() => null);

        const companies = await page.evaluate(() => {
            const cards = document.querySelectorAll('.minicard-item');
            const results: ZoonCompany[] = [];

            cards.forEach(card => {
                try {
                    const nameEl = card.querySelector('.minicard-item__title');
                    const categoryEl = card.querySelector('.minicard-item__subtitle');
                    const addressEl = card.querySelector('.minicard-item__address');
                    const phoneEl = card.querySelector('.minicard-item__phone');
                    const ratingEl = card.querySelector('.z-rating__value');
                    const reviewsEl = card.querySelector('.minicard-item__reviews');

                    if (nameEl) {
                        results.push({
                            name: nameEl.textContent?.trim() || '',
                            category: categoryEl?.textContent?.trim() || '',
                            address: addressEl?.textContent?.trim() || '',
                            phone: phoneEl?.textContent?.trim(),
                            rating: ratingEl ? parseFloat(ratingEl.textContent || '0') : undefined,
                            reviewCount: reviewsEl
                                ? parseInt(reviewsEl.textContent?.match(/\d+/)?.[0] || '0')
                                : undefined,
                        });
                    }
                } catch (e) {
                    // Skip
                }
            });

            return results.slice(0, 25);
        });

        return companies;
    }

    private companyToLead(
        company: ZoonCompany,
        search: { city: string; category: string }
    ): DiscoveredLead | null {
        if (!company.name) return null;

        // Prioritize companies with reviews (more established)
        const hasGoodReviews = company.reviewCount && company.reviewCount > 5;
        const hasHighRating = company.rating && company.rating >= 4;

        return {
            firstName: 'Директор',
            lastName: company.name,
            companyName: company.name,
            phone: company.phone,
            jobTitle: company.category || 'Руководитель',
            signals: [
                `zoon_${search.category}`,
                search.city,
                hasGoodReviews ? 'has_reviews' : '',
                hasHighRating ? 'high_rated' : '',
            ].filter(Boolean) as string[],
            rawData: {
                source: 'zoon',
                city: search.city,
                category: search.category,
                address: company.address,
                website: company.website,
                rating: company.rating,
                reviewCount: company.reviewCount,
            },
        };
    }
}

export const zoonScraper = new ZoonScraper();
