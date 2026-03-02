/**
 * VC.ru Scraper
 * Scrapes vc.ru for founders/entrepreneurs writing about their startups
 * Great source for CIS tech founders
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';
import { config } from './config.js';

interface VCAuthor {
    name: string;
    username: string;
    bio?: string;
    company?: string;
    profileUrl: string;
    articleTitle: string;
}

/**
 * Topics that indicate potential leads
 */
const SIGNAL_TOPICS = [
    'стартапы',           // Startups
    'бизнес',             // Business
    'автоматизация',      // Automation
    'разработка',         // Development
    'искусственный-интеллект', // AI
    'финтех',             // Fintech
    'saas',               // SaaS
];

export class VCRuScraper implements DiscoveryAdapter {
    readonly name = 'vc_ru';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://vc.ru';
    private maxArticlesPerTopic = 20;

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[VC_SCRAPER] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenAuthors = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const topic of SIGNAL_TOPICS) {
                try {
                    const authors = await this.scrapeTopicAuthors(page, topic);
                    console.log(`[VC_SCRAPER] Found ${authors.length} authors in topic "${topic}"`);

                    for (const author of authors) {
                        // Dedupe by username
                        if (seenAuthors.has(author.username)) continue;
                        seenAuthors.add(author.username);

                        const lead = this.authorToLead(author, topic);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[VC_SCRAPER] Error scraping topic "${topic}":`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    /**
     * Scrape authors from a topic page
     */
    private async scrapeTopicAuthors(page: BrowserPage, topic: string): Promise<VCAuthor[]> {
        const topicUrl = `${this.baseUrl}/${topic}`;
        await page.goto(topicUrl, { waitUntil: 'networkidle' });

        // Wait for articles to load
        await page.waitForSelector('.feed__item', { timeout: 10000 }).catch(() => null);

        const authors = await page.evaluate(() => {
            const articles = document.querySelectorAll('.feed__item');
            const results: VCAuthor[] = [];

            articles.forEach(article => {
                try {
                    const authorEl = article.querySelector('.content-header__author a');
                    const titleEl = article.querySelector('.content-header-author__name');
                    const bioEl = article.querySelector('.content-header-author__desc');
                    const articleTitleEl = article.querySelector('.content-title');

                    if (authorEl && titleEl) {
                        const profileUrl = (authorEl as HTMLAnchorElement).href || '';
                        const username = profileUrl.split('/').pop() || '';

                        // Try to extract company from bio
                        const bio = bioEl?.textContent?.trim() || '';
                        let company = '';

                        // Common patterns: "CEO at Company", "Founder of Company", "Company"
                        const companyMatch = bio.match(/(?:CEO|CTO|Founder|Основатель|директор)\s+(?:at|в|of)?\s*([^,|]+)/i);
                        if (companyMatch) {
                            company = companyMatch[1].trim();
                        }

                        results.push({
                            name: titleEl.textContent?.trim() || '',
                            username,
                            bio,
                            company,
                            profileUrl,
                            articleTitle: articleTitleEl?.textContent?.trim() || '',
                        });
                    }
                } catch (e) {
                    // Skip malformed articles
                }
            });

            return results.slice(0, 20);
        });

        return authors;
    }

    /**
     * Convert VC.ru author to lead
     */
    private authorToLead(author: VCAuthor, topic: string): DiscoveredLead | null {
        if (!author.name) return null;

        const nameParts = author.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        // Determine if this is a good lead based on bio/role
        const isFounder = /founder|ceo|cto|основатель|директор/i.test(author.bio || '');

        return {
            firstName,
            lastName,
            companyName: author.company || 'Unknown',
            jobTitle: author.bio?.slice(0, 100) || '',
            signals: [
                `vc_ru_${topic}`,
                author.articleTitle.slice(0, 50),
                isFounder ? 'founder' : '',
            ].filter(Boolean) as string[],
            rawData: {
                source: 'vc_ru',
                topic,
                profileUrl: author.profileUrl,
                articleTitle: author.articleTitle,
                bio: author.bio,
            },
        };
    }
}

// Singleton
export const vcRuScraper = new VCRuScraper();
