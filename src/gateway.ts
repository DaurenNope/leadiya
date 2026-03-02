/**
 * Browser Gateway
 * Provides browser automation for scraping using Playwright
 */

import { chromium, type Browser, type Page } from 'playwright';

/**
 * Browser instance wrapper for consistent interface
 */
export interface BrowserInstance {
    newPage: () => Promise<BrowserPage>;
    close: () => Promise<void>;
}

export interface BrowserPage {
    goto: (url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) => Promise<void>;
    goBack: (options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }) => Promise<void>;
    waitForSelector: (selector: string, options?: { timeout?: number }) => Promise<void>;
    click: (selector: string) => Promise<void>;
    type: (selector: string, text: string) => Promise<void>;
    evaluate: <T>(fn: () => T) => Promise<T>;
    $: (selector: string) => Promise<{ click: () => Promise<void> } | null>;
    screenshot: (options?: { path?: string }) => Promise<Buffer>;
    content: () => Promise<string>;
    close: () => Promise<void>;
    waitForTimeout: (ms: number) => Promise<void>;
}

/**
 * Simple browser gateway using Playwright directly
 */
class BrowserGateway {
    private browser: Browser | null = null;

    /**
     * Check if browser can be launched
     */
    isAvailable(): boolean {
        return true; // Playwright is always available
    }

    /**
     * Get or launch browser instance
     */
    async getBrowser(): Promise<BrowserInstance> {
        if (!this.browser) {
            console.log('[BROWSER] Launching Chromium...');
            this.browser = await chromium.launch({
                headless: false, // 2GIS blocks headless browsers
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const browser = this.browser;

        return {
            newPage: async (): Promise<BrowserPage> => {
                const page = await browser.newPage();
                return this.wrapPage(page);
            },
            close: async () => {
                // Don't actually close - reuse browser
                // await browser.close();
            }
        };
    }

    /**
     * Wrap Playwright Page to our interface
     */
    private wrapPage(page: Page): BrowserPage {
        return {
            goto: async (url, options) => {
                await page.goto(url, {
                    waitUntil: options?.waitUntil || 'domcontentloaded',
                    timeout: 30000
                });
            },
            waitForSelector: async (selector, options) => {
                await page.waitForSelector(selector, { timeout: options?.timeout || 5000 });
            },
            click: async (selector) => {
                await page.click(selector);
            },
            type: async (selector, text) => {
                await page.fill(selector, text);
            },
            evaluate: async <T>(fn: () => T): Promise<T> => {
                return page.evaluate(fn);
            },
            screenshot: async (options) => {
                return page.screenshot({ path: options?.path });
            },
            content: async () => {
                return page.content();
            },
            close: async () => {
                await page.close();
            },
            waitForTimeout: async (ms) => {
                await page.waitForTimeout(ms);
            },
            goBack: async (options) => {
                await page.goBack({ waitUntil: options?.waitUntil || 'domcontentloaded' });
            },
            $: async (selector) => {
                const el = await page.$(selector);
                if (!el) return null;
                return {
                    click: async () => await el.click()
                };
            }
        };
    }

    /**
     * Shutdown browser completely
     */
    async shutdown(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            console.log('[BROWSER] Closed');
        }
    }
}

// Singleton
export const gateway = new BrowserGateway();
