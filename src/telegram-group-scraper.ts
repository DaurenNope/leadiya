/**
 * Telegram Group Scraper
 * Extracts members from public Telegram groups
 * Uses Telegram Web preview for public groups
 * 
 * For private groups, requires Telegram API (MTProto) with user session
 */

import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

interface TelegramMember {
    username: string;
    displayName: string;
    groupName: string;
    groupUrl: string;
}

// Business/startup groups in CIS region
const TARGET_GROUPS = [
    // Kazakhstan business
    { name: 'bizkazakhstan', url: 'https://t.me/bizkazakhstan' },
    { name: 'startupsalmaty', url: 'https://t.me/startupsalmaty' },
    { name: 'italmaty', url: 'https://t.me/italmaty' },

    // Russian startups
    { name: 'startupoftheday', url: 'https://t.me/startupoftheday' },
    { name: 'rusbase', url: 'https://t.me/rusbase' },
    { name: 'vcru', url: 'https://t.me/vcru' },

    // General business
    { name: 'biznes_kanal', url: 'https://t.me/biznes_kanal' },
];

/**
 * Scrape public Telegram group preview for visible members
 * Note: This only works for public groups and shows limited members
 * For full member list, need Telegram API with user auth
 */
export async function scrapeTelegramGroups(): Promise<TelegramMember[]> {
    console.log('[TG_SCRAPER] Starting Telegram group scraper...');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const members: TelegramMember[] = [];
    const seenUsers = new Set<string>();

    try {
        for (const group of TARGET_GROUPS) {
            console.log(`[TG_SCRAPER] Scraping group: ${group.name}`);

            try {
                const groupMembers = await scrapeGroupPreview(page, group.url, group.name);

                for (const m of groupMembers) {
                    if (!seenUsers.has(m.username)) {
                        seenUsers.add(m.username);
                        members.push(m);
                    }
                }

                console.log(`[TG_SCRAPER] Found ${groupMembers.length} members in ${group.name}`);
            } catch (e) {
                console.error(`[TG_SCRAPER] Error scraping ${group.name}:`, e);
            }

            // Rate limit
            await page.waitForTimeout(2000);
        }
    } finally {
        await browser.close();
    }

    console.log(`[TG_SCRAPER] Total unique members: ${members.length}`);
    return members;
}

async function scrapeGroupPreview(page: Page, groupUrl: string, groupName: string): Promise<TelegramMember[]> {
    // Use Telegram Web preview
    const previewUrl = groupUrl.replace('t.me/', 't.me/s/');
    await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Extract from channel posts - get authors
    const members = await page.evaluate(({ gName, gUrl }: { gName: string; gUrl: string }) => {
        const results: { username: string; displayName: string; groupName: string; groupUrl: string }[] = [];
        const seen = new Set<string>();

        // Get message authors (if it's a group with visible authors)
        document.querySelectorAll('.tgme_widget_message_author, .tgme_widget_message_owner_name').forEach(el => {
            try {
                const link = el.querySelector('a');
                if (link) {
                    const href = link.getAttribute('href') || '';
                    const username = href.split('/').pop() || '';
                    const displayName = link.textContent?.trim() || '';

                    if (username && !seen.has(username) && username !== gName) {
                        seen.add(username);
                        results.push({
                            username,
                            displayName,
                            groupName: gName,
                            groupUrl: gUrl,
                        });
                    }
                }
            } catch (e) { }
        });

        // Also try to get from forwarded messages
        document.querySelectorAll('.tgme_widget_message_forwarded_from_name').forEach(el => {
            try {
                const link = el.querySelector('a') || (el as HTMLAnchorElement);
                const href = link.getAttribute('href') || '';
                const username = href.split('/').pop() || '';
                const displayName = el.textContent?.trim() || '';

                if (username && !seen.has(username)) {
                    seen.add(username);
                    results.push({
                        username,
                        displayName,
                        groupName: gName,
                        groupUrl: gUrl,
                    });
                }
            } catch (e) { }
        });

        return results;
    }, { gName: groupName, gUrl: groupUrl });

    return members;
}

/**
 * Alternative: Use Telegram Bot API to get group members
 * Requires bot to be admin in the group
 */
export async function getGroupMembersViaBot(botToken: string, chatId: string): Promise<TelegramMember[]> {
    try {
        const response = await fetch(
            `https://api.telegram.org/bot${botToken}/getChatAdministrators?chat_id=${chatId}`
        );
        const data = await response.json() as { ok: boolean; result: Array<{ user: { username?: string; first_name: string; last_name?: string } }> };

        if (!data.ok) return [];

        return data.result.map(admin => ({
            username: admin.user.username || '',
            displayName: `${admin.user.first_name} ${admin.user.last_name || ''}`.trim(),
            groupName: chatId,
            groupUrl: `https://t.me/${chatId.replace('@', '')}`,
        })).filter(m => m.username);
    } catch (e) {
        console.error('[TG_SCRAPER] Bot API error:', e);
        return [];
    }
}

/**
 * Save Telegram members as leads
 */
export async function saveTelegramMembersAsLeads(): Promise<number> {
    const members = await scrapeTelegramGroups();

    await leads.connect();
    let saved = 0;

    for (const m of members) {
        // Check if already exists
        const existing = await leads.existsByEmail(`${m.username}@telegram`);
        if (existing) continue;

        const lead: Parameters<typeof leads.create>[0] = {
            firstName: m.displayName.split(' ')[0] || m.username,
            lastName: m.displayName.split(' ').slice(1).join(' ') || '',
            companyName: m.displayName || m.username,
            email: '', // No email
            website: `https://t.me/${m.username}`,
            phone: '', // Could be their TG username for WhatsApp-like contact
            source: 'scrape',
            state: 'discovered',
            tags: ['telegram', m.groupName, 'business'],
            notes: [
                `Telegram: @${m.username}`,
                `Found in group: ${m.groupName}`,
                `Group URL: ${m.groupUrl}`,
            ],
        };

        await leads.create(lead);
        saved++;
    }

    console.log(`[TG_SCRAPER] Saved ${saved} new leads from Telegram groups`);
    return saved;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    saveTelegramMembersAsLeads()
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}
