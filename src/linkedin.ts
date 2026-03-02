/**
 * LinkedIn Scraper
 * Uses Moltbot browser automation to discover leads from LinkedIn
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';
import { config } from './config.js';

interface LinkedInProfile {
    name: string;
    headline: string;
    company: string;
    location: string;
    profileUrl: string;
    connectionDegree?: string;
}

export class LinkedInScraper implements DiscoveryAdapter {
    readonly name = 'linkedin';
    readonly source: LeadSource = 'linkedin';

    private isLoggedIn = false;
    private maxResults = 50;
    private delayBetweenPages = 3000; // 3 seconds

    /**
     * Check if browser is available
     */
    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    /**
     * Build search URL from ICP config
     */
    private buildSearchUrl(): string {
        const icp = config.loadICP();

        // Build Sales Navigator style search
        const roles = icp.targeting.roles.include;
        const keywords = roles.join(' OR ');

        // Basic LinkedIn search (not Sales Nav)
        const params = new URLSearchParams({
            keywords: keywords,
            origin: 'GLOBAL_SEARCH_HEADER',
        });

        return `https://www.linkedin.com/search/results/people/?${params}`;
    }

    /**
     * Discover leads from LinkedIn search
     */
    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[LINKEDIN] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            // Check login status
            await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle' });
            const content = await page.content();

            if (content.includes('session_redirect') || content.includes('login')) {
                console.log('[LINKEDIN] Not logged in - skipping scrape');
                await browser.close();
                return [];
            }

            console.log('[LINKEDIN] Logged in, starting search...');
            this.isLoggedIn = true;

            // Navigate to search
            const searchUrl = this.buildSearchUrl();
            console.log(`[LINKEDIN] Searching: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'networkidle' });

            // Wait for results
            await page.waitForSelector('.search-results-container', { timeout: 10000 });

            // Extract profiles
            const profiles = await this.extractProfiles(page);
            console.log(`[LINKEDIN] Found ${profiles.length} profiles`);

            // Convert to leads
            for (const profile of profiles) {
                const lead = this.profileToLead(profile);
                if (lead) {
                    leads.push(lead);
                }
            }

        } catch (error) {
            console.error('[LINKEDIN] Scrape error:', error);
        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    /**
     * Extract profiles from search results page
     */
    private async extractProfiles(page: BrowserPage): Promise<LinkedInProfile[]> {
        return page.evaluate(() => {
            const profiles: LinkedInProfile[] = [];
            const cards = document.querySelectorAll('.reusable-search__result-container');

            cards.forEach(card => {
                try {
                    const nameEl = card.querySelector('.entity-result__title-text a span[aria-hidden="true"]');
                    const headlineEl = card.querySelector('.entity-result__primary-subtitle');
                    const locationEl = card.querySelector('.entity-result__secondary-subtitle');
                    const linkEl = card.querySelector('.entity-result__title-text a') as HTMLAnchorElement;

                    if (nameEl && linkEl) {
                        const name = nameEl.textContent?.trim() || '';
                        const headline = headlineEl?.textContent?.trim() || '';

                        // Extract company from headline (common format: "Role at Company")
                        const companyMatch = headline.match(/(?:at|@)\s+(.+?)(?:\s*[|•·]|$)/i);
                        const company = companyMatch?.[1]?.trim() || '';

                        profiles.push({
                            name,
                            headline,
                            company,
                            location: locationEl?.textContent?.trim() || '',
                            profileUrl: linkEl.href,
                        });
                    }
                } catch (e) {
                    // Skip malformed cards
                }
            });

            return profiles;
        });
    }

    /**
     * Convert LinkedIn profile to lead
     */
    private profileToLead(profile: LinkedInProfile): DiscoveredLead | null {
        if (!profile.name) return null;

        const nameParts = profile.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        return {
            firstName,
            lastName,
            companyName: profile.company || 'Unknown',
            jobTitle: profile.headline,
            linkedinUrl: profile.profileUrl,
            signals: this.extractSignalsFromHeadline(profile.headline),
        };
    }

    /**
     * Extract buying signals from headline
     */
    private extractSignalsFromHeadline(headline: string): string[] {
        const signals: string[] = [];
        const icp = config.loadICP();
        const lowerHeadline = headline.toLowerCase();

        // Check for positive signals
        for (const signal of [...icp.signals.strongPositive, ...icp.signals.moderatePositive]) {
            if (lowerHeadline.includes(signal.pattern.toLowerCase())) {
                signals.push(signal.pattern);
            }
        }

        return signals;
    }

    /**
     * Scrape a specific profile for enrichment
     */
    async scrapeProfile(profileUrl: string): Promise<Partial<DiscoveredLead> | null> {
        const browser = await gateway.getBrowser();
        if (!browser) return null;

        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();
            await page.goto(profileUrl, { waitUntil: 'networkidle' });

            // Wait for profile to load
            await page.waitForSelector('.pv-top-card', { timeout: 10000 });

            const data = await page.evaluate(() => {
                const nameEl = document.querySelector('.pv-top-card h1');
                const headlineEl = document.querySelector('.pv-top-card .text-body-medium');
                const aboutEl = document.querySelector('#about + div .pv-shared-text-with-see-more');
                const experienceItems = document.querySelectorAll('#experience + div .pvs-entity');

                // Get current company from experience
                const currentExp = experienceItems[0];
                const companyEl = currentExp?.querySelector('.pv-entity__secondary-title');

                return {
                    name: nameEl?.textContent?.trim(),
                    headline: headlineEl?.textContent?.trim(),
                    about: aboutEl?.textContent?.trim()?.slice(0, 500),
                    company: companyEl?.textContent?.trim(),
                };
            });

            if (!data.name) return null;

            const nameParts = data.name.split(' ');

            return {
                firstName: nameParts[0],
                lastName: nameParts.slice(1).join(' '),
                companyName: data.company,
                jobTitle: data.headline,
                signals: data.about ? this.extractSignalsFromHeadline(data.about) : [],
            };

        } catch (error) {
            console.error('[LINKEDIN] Profile scrape error:', error);
            return null;
        } finally {
            if (page) await page.close();
            await browser.close();
        }
    }
}

// Singleton
export const linkedinScraper = new LinkedInScraper();
