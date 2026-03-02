/**
 * Telegram Group Scraper
 * Scrapes members from relevant Telegram groups/channels
 * Primary source for CIS leads
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';
import { config } from './config.js';

interface TelegramMember {
    username: string;
    name: string;
    bio?: string;
}

/**
 * Target Telegram groups for CIS founders/entrepreneurs
 */
const CIS_GROUPS = [
    // Startup/Business communities
    't.me/startupkz',           // Kazakhstan startups
    't.me/startupmoscow',       // Moscow startups
    't.me/it_almaty',           // Almaty IT
    't.me/founders_chat',       // Founders chat
    't.me/biznes_ru',           // Russian business

    // Tech communities
    't.me/devkz',               // Kazakhstan developers
    't.me/webdev_ru',           // Russian web developers
    't.me/productclub',         // Product managers

    // AI/Automation (our ICP)
    't.me/ai_ru',               // AI Russia
    't.me/automation_chat',     // Automation enthusiasts
];

export class TelegramGroupScraper implements DiscoveryAdapter {
    readonly name = 'telegram_groups';
    readonly source: LeadSource = 'telegram';

    private targetGroups: string[] = CIS_GROUPS;
    private maxMembersPerGroup = 50;

    /**
     * Check if Moltbot browser is available
     */
    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    /**
     * Discover leads from Telegram groups
     */
    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[TELEGRAM_SCRAPER] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const group of this.targetGroups) {
                try {
                    const members = await this.scrapeGroup(page, group);
                    console.log(`[TELEGRAM_SCRAPER] Found ${members.length} members in ${group}`);

                    for (const member of members) {
                        const lead = this.memberToLead(member, group);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[TELEGRAM_SCRAPER] Error scraping ${group}:`, error);
                }
            }

        } finally {
            if (page) await page.close();
            await browser.close();
        }

        return leads;
    }

    /**
     * Scrape a single Telegram group/channel
     */
    private async scrapeGroup(page: BrowserPage, groupUrl: string): Promise<TelegramMember[]> {
        // Navigate to group info page
        const webUrl = `https://t.me/${groupUrl.replace('t.me/', '')}`;
        await page.goto(webUrl, { waitUntil: 'networkidle' });

        // Try to get member list (if public group)
        // Note: Private groups won't work without being a member

        const members = await page.evaluate(() => {
            const memberElements = document.querySelectorAll('.tgme_widget_message_author');
            const seen = new Set<string>();
            const result: TelegramMember[] = [];

            memberElements.forEach(el => {
                const linkEl = el.querySelector('a');
                const nameEl = el.querySelector('.tgme_widget_message_author_name');

                if (linkEl && nameEl) {
                    const href = linkEl.getAttribute('href') || '';
                    const username = href.replace('https://t.me/', '').replace('/', '');

                    if (username && !seen.has(username)) {
                        seen.add(username);
                        result.push({
                            username,
                            name: nameEl.textContent?.trim() || username,
                        });
                    }
                }
            });

            return result.slice(0, 50); // Limit per group
        });

        return members;
    }

    /**
     * Convert Telegram member to lead
     */
    private memberToLead(member: TelegramMember, sourceGroup: string): DiscoveredLead | null {
        if (!member.username || !member.name) return null;

        // Parse name (often in format "FirstName LastName" or just "Name")
        const nameParts = member.name.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ') || '';

        return {
            firstName,
            lastName,
            companyName: 'Unknown', // Will be enriched later
            telegramHandle: `@${member.username}`,
            signals: [sourceGroup], // Track which group they came from
            rawData: {
                source: 'telegram_group',
                group: sourceGroup,
                bio: member.bio,
            },
        };
    }

    /**
     * Add custom groups to scrape
     */
    addGroup(groupUrl: string): void {
        if (!this.targetGroups.includes(groupUrl)) {
            this.targetGroups.push(groupUrl);
        }
    }
}

// Singleton
export const telegramGroupScraper = new TelegramGroupScraper();
