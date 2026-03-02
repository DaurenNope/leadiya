/**
 * Leadiya Sources Module
 * Manages lead sources configuration and execution
 * Supports: Directory (2GIS, Yelp), Telegram, Website, API, Import
 */

import { createClient, RedisClientType } from 'redis';
import { v4 as uuid } from 'uuid';

export interface SourceConfig {
    // Directory
    service?: string;
    city?: string;
    category?: string;
    // Telegram
    group?: string;
    // Website
    url?: string;
    itemSelector?: string;
    nameSelector?: string;
    phoneSelector?: string;
    emailSelector?: string;
    // API
    provider?: string;
    apiKey?: string;
    query?: string;
    // Import
    mapping?: string;
}

export interface Source {
    id: string;
    name: string;
    type: 'directory' | 'telegram' | 'website' | 'api' | 'import';
    config: SourceConfig;
    schedule: 'manual' | 'daily' | 'weekly';
    status: 'active' | 'paused' | 'error';
    stats: {
        totalLeads: number;
        lastRun: string | null;
        lastError?: string;
    };
    createdAt: string;
}

class SourcesManager {
    private client: RedisClientType | null = null;
    private readonly KEY_PREFIX = 'leadiya:source:';

    async connect(): Promise<void> {
        if (this.client?.isOpen) return;

        this.client = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });

        this.client.on('error', (err) => console.error('[SOURCES] Redis error:', err));
        await this.client.connect();
    }

    async getAll(): Promise<Source[]> {
        if (!this.client) await this.connect();

        const keys = await this.client!.keys(`${this.KEY_PREFIX}*`);
        if (keys.length === 0) return [];

        const sources: Source[] = [];
        for (const key of keys) {
            const data = await this.client!.get(key);
            if (data) {
                sources.push(JSON.parse(data));
            }
        }

        return sources.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }

    async get(id: string): Promise<Source | null> {
        if (!this.client) await this.connect();

        const data = await this.client!.get(`${this.KEY_PREFIX}${id}`);
        return data ? JSON.parse(data) : null;
    }

    async create(source: Omit<Source, 'id' | 'createdAt' | 'stats'>): Promise<Source> {
        if (!this.client) await this.connect();

        const newSource: Source = {
            ...source,
            id: uuid(),
            createdAt: new Date().toISOString(),
            stats: {
                totalLeads: 0,
                lastRun: null
            }
        };

        await this.client!.set(
            `${this.KEY_PREFIX}${newSource.id}`,
            JSON.stringify(newSource)
        );

        return newSource;
    }

    async update(id: string, updates: Partial<Source>): Promise<Source | null> {
        if (!this.client) await this.connect();

        const existing = await this.get(id);
        if (!existing) return null;

        const updated = { ...existing, ...updates };
        await this.client!.set(`${this.KEY_PREFIX}${id}`, JSON.stringify(updated));

        return updated;
    }

    async delete(id: string): Promise<boolean> {
        if (!this.client) await this.connect();

        const result = await this.client!.del(`${this.KEY_PREFIX}${id}`);
        return result > 0;
    }

    async updateStats(id: string, leadsAdded: number, error?: string): Promise<void> {
        if (!this.client) await this.connect();

        const source = await this.get(id);
        if (!source) return;

        source.stats.totalLeads += leadsAdded;
        source.stats.lastRun = new Date().toISOString();

        if (error) {
            source.stats.lastError = error;
            source.status = 'error';
        } else {
            delete source.stats.lastError;
            source.status = 'active';
        }

        await this.client!.set(`${this.KEY_PREFIX}${id}`, JSON.stringify(source));
    }
}

export const sources = new SourcesManager();

/**
 * Run a source scraper based on its type
 * Returns number of leads added
 */
export async function runSource(source: Source, headless = true): Promise<{ success: boolean; leadsAdded: number; error?: string }> {
    console.log(`[SOURCES] Running source: ${source.name} (${source.type})`);

    try {
        switch (source.type) {
            case 'directory':
                return await runDirectoryScraper(source.config, headless);
            case 'telegram':
                return await runTelegramScraper(source.config, headless);
            case 'website':
                return await runWebsiteScraper(source.config, headless);
            case 'api':
                return await runApiScraper(source.config);
            case 'import':
                return { success: true, leadsAdded: 0, error: 'Import via UI only' };
            default:
                return { success: false, leadsAdded: 0, error: 'Unknown source type' };
        }
    } catch (e: any) {
        console.error(`[SOURCES] Error running ${source.name}:`, e);
        return { success: false, leadsAdded: 0, error: e.message };
    }
}

// Directory Scraper (2GIS, Google Maps, Yelp)
async function runDirectoryScraper(config: SourceConfig, headless: boolean): Promise<{ success: boolean; leadsAdded: number; error?: string }> {
    const { service, city, category } = config;

    if (service === '2gis') {
        // Use existing 2GIS scraper
        const { twoGISScraper } = await import('./2gis-scraper.js');
        const { leads } = await import('./leads.js');

        // TwoGISScraper uses internal TARGET_CATEGORIES
        const discovered = await twoGISScraper.discover();

        // Save to leads
        await leads.connect();
        let saved = 0;
        for (const d of discovered) {
            if (d.phone) {
                const raw = d.rawData as Record<string, any> || {};
                await leads.create({
                    companyName: d.companyName,
                    phone: d.phone || '',
                    email: d.email || '',
                    website: raw?.website || '',
                    source: 'scrape',
                    state: 'discovered',
                    tags: ['2gis', raw?.city || 'kz']
                });
                saved++;
            }
        }
        return { success: true, leadsAdded: saved };
    }

    // TODO: Add Google Maps, Yelp scrapers
    return { success: false, leadsAdded: 0, error: `Service ${service} not implemented` };
}

// Telegram Scraper
async function runTelegramScraper(config: SourceConfig, headless: boolean): Promise<{ success: boolean; leadsAdded: number; error?: string }> {
    const { group } = config;

    if (!group) {
        return { success: false, leadsAdded: 0, error: 'No group specified' };
    }

    // Use MTProto scraper if credentials available, otherwise fallback to preview scraper
    try {
        const { scrapeTelegramMTProto } = await import('./telegram-mtproto-scraper.js');
        const saved = await scrapeTelegramMTProto();
        return { success: true, leadsAdded: saved };
    } catch (e: any) {
        // Fallback to basic web preview
        return { success: false, leadsAdded: 0, error: 'Telegram MTProto not configured: ' + e.message };
    }
}

// Website Scraper (custom selectors)
async function runWebsiteScraper(config: SourceConfig, headless: boolean): Promise<{ success: boolean; leadsAdded: number; error?: string }> {
    const { url, itemSelector, nameSelector, phoneSelector, emailSelector } = config;

    if (!url || !itemSelector) {
        return { success: false, leadsAdded: 0, error: 'URL and item selector required' };
    }

    const { chromium } = await import('playwright');
    const { leads } = await import('./leads.js');

    const browser = await chromium.launch({ headless });
    const page = await browser.newPage();
    let saved = 0;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        const items = await page.$$(itemSelector);
        console.log(`[SOURCES] Found ${items.length} items on ${url}`);

        await leads.connect();

        for (const item of items) {
            try {
                const name = nameSelector
                    ? await item.$eval(nameSelector, el => el.textContent?.trim() || '')
                    : '';
                const phone = phoneSelector
                    ? await item.$eval(phoneSelector, el => el.textContent?.trim() || '')
                    : '';
                const email = emailSelector
                    ? await item.$eval(emailSelector, el => el.textContent?.trim() || '')
                    : '';

                if (name && (phone || email)) {
                    await leads.create({
                        companyName: name,
                        phone,
                        email,
                        website: url,
                        source: 'scrape',
                        state: 'discovered',
                        tags: ['website_scrape']
                    });
                    saved++;
                }
            } catch (e) {
                // Skip items that don't match selectors
            }
        }
    } finally {
        await browser.close();
    }

    return { success: true, leadsAdded: saved };
}

// API Scraper (Apollo, Instantly)
async function runApiScraper(config: SourceConfig): Promise<{ success: boolean; leadsAdded: number; error?: string }> {
    const { provider, apiKey, query } = config;

    if (!apiKey) {
        return { success: false, leadsAdded: 0, error: 'API key required' };
    }

    // TODO: Implement Apollo, Instantly API integrations
    return { success: false, leadsAdded: 0, error: `Provider ${provider} not implemented yet` };
}
