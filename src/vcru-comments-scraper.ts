/**
 * VC.ru Commenter Scraper
 * Scrapes commenters from popular business articles on vc.ru
 * These are engaged users actively discussing startups/business
 */

import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';
import type { Lead } from './types.js';

interface VCCommenter {
    name: string;
    username: string;
    profileUrl: string;
    commentText: string;
    articleUrl: string;
    articleTitle: string;
}

// Hot topics that attract business people
const HOT_TOPICS = [
    'стартапы',           // Startups
    'бизнес',             // Business  
    'автоматизация',      // Automation
    'маркетинг',          // Marketing
    'продажи',            // Sales
    'финтех',             // Fintech
];

export async function scrapeVCCommenters(maxArticles = 5): Promise<VCCommenter[]> {
    console.log('[VC_COMMENTS] Starting VC.ru commenter scraper...');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const commenters: VCCommenter[] = [];
    const seenUsers = new Set<string>();

    try {
        for (const topic of HOT_TOPICS) {
            console.log(`[VC_COMMENTS] Scraping topic: ${topic}`);

            // Get article list
            await page.goto(`https://vc.ru/${topic}`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);

            // Get article links
            const articleLinks = await page.evaluate(() => {
                const links: string[] = [];
                document.querySelectorAll('a.content-link').forEach(el => {
                    const href = (el as HTMLAnchorElement).href;
                    if (href && href.includes('/')) {
                        links.push(href);
                    }
                });
                return links.slice(0, 5);
            });

            console.log(`[VC_COMMENTS] Found ${articleLinks.length} articles in ${topic}`);

            // Scrape comments from each article
            for (const articleUrl of articleLinks.slice(0, maxArticles)) {
                try {
                    const articleCommenters = await scrapeArticleComments(page, articleUrl);

                    for (const c of articleCommenters) {
                        if (!seenUsers.has(c.username)) {
                            seenUsers.add(c.username);
                            commenters.push(c);
                        }
                    }
                } catch (e) {
                    console.error(`[VC_COMMENTS] Error on ${articleUrl}:`, e);
                }
            }
        }
    } finally {
        await browser.close();
    }

    console.log(`[VC_COMMENTS] Total unique commenters: ${commenters.length}`);
    return commenters;
}

async function scrapeArticleComments(page: Page, articleUrl: string): Promise<VCCommenter[]> {
    await page.goto(articleUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Scroll to load comments
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    const articleTitle = await page.title();

    const commenters = await page.evaluate((url: string) => {
        const results: Omit<VCCommenter, 'articleUrl'>[] = [];

        // Try various comment selectors
        const commentEls = document.querySelectorAll('.comment, [data-comment-id], .comments__item');

        commentEls.forEach(el => {
            try {
                const authorEl = el.querySelector('a[href*="/u/"], .comment__author a, .user-link');
                const textEl = el.querySelector('.comment__text, .comment-content, [data-comment-text]');

                if (authorEl && textEl) {
                    const profileUrl = (authorEl as HTMLAnchorElement).href || '';
                    const username = profileUrl.split('/u/').pop()?.split('/')[0] || '';
                    const name = authorEl.textContent?.trim() || '';
                    const commentText = textEl.textContent?.trim().slice(0, 200) || '';

                    if (username && name) {
                        results.push({
                            name,
                            username,
                            profileUrl,
                            commentText,
                            articleTitle: document.title,
                        });
                    }
                }
            } catch (e) { }
        });

        return results;
    }, articleUrl);

    return commenters.map(c => ({ ...c, articleUrl }));
}

/**
 * Convert commenters to leads and save
 */
export async function saveVCCommentersAsLeads(): Promise<number> {
    const commenters = await scrapeVCCommenters();

    await leads.connect();
    let saved = 0;

    for (const c of commenters) {
        // Parse name
        const nameParts = c.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';

        // Check if already exists
        const existing = await leads.existsByEmail(`${c.username}@vc.ru`);
        if (existing) continue;

        const lead: Parameters<typeof leads.create>[0] = {
            firstName,
            lastName,
            companyName: `VC.ru User: ${c.username}`,
            email: '', // No email, but we have profile
            website: c.profileUrl,
            source: 'scrape',
            state: 'discovered',
            tags: ['vc_ru', 'commenter', 'active'],
            notes: [
                `VC.ru profile: ${c.profileUrl}`,
                `Comment on: ${c.articleTitle}`,
                `Said: "${c.commentText.slice(0, 100)}..."`,
            ],
        };

        await leads.create(lead);
        saved++;
    }

    console.log(`[VC_COMMENTS] Saved ${saved} new leads from VC.ru comments`);
    return saved;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    saveVCCommentersAsLeads()
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}
