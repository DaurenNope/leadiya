/**
 * 2GIS Company Scraper
 * Scrapes company listings from 2GIS (popular in CIS)
 * Finds companies by category and location
 */

import { gateway, type BrowserPage } from './gateway.js';
import type { DiscoveredLead, DiscoveryAdapter } from './discovery.js';
import type { LeadSource } from './types.js';

interface Company2GIS {
    name: string;
    category: string;
    address: string;
    phone?: string;
    website?: string;
    instagram?: string;
    whatsapp?: string;
    telegram?: string;
    email?: string;
    rating?: number;
    // Extra data from website scraping
    allEmails?: string[];
    allPhones?: string[];
    facebook?: string;
    youtube?: string;
}

/**
 * TARGET VERTICALS: 3 focused sectors for RahmetLabs
 * 1. Education - Universities, schools, training (YOU HAVE PROOF: AGEU, Q-Uni)
 * 2. Logistics - Transport, cargo, warehouses (high automation pain)
 * 3. Real Estate - Developers, agencies (you had contacts)
 */
const TARGET_CATEGORIES = [
    // ═══════════════════════════════════════════════════════════════
    // EDUCATION - Primary focus (you have AGEU + Q-University proof)
    // ═══════════════════════════════════════════════════════════════
    // Almaty
    { city: 'almaty', category: 'университеты', vertical: 'education' },
    { city: 'almaty', category: 'высшие учебные заведения', vertical: 'education' },
    { city: 'almaty', category: 'частные школы', vertical: 'education' },
    { city: 'almaty', category: 'колледжи', vertical: 'education' },
    { city: 'almaty', category: 'учебные центры', vertical: 'education' },
    { city: 'almaty', category: 'курсы повышения квалификации', vertical: 'education' },
    // Astana
    { city: 'astana', category: 'университеты', vertical: 'education' },
    { city: 'astana', category: 'высшие учебные заведения', vertical: 'education' },
    { city: 'astana', category: 'частные школы', vertical: 'education' },
    { city: 'astana', category: 'колледжи', vertical: 'education' },

    // ═══════════════════════════════════════════════════════════════
    // LOGISTICS - High pain, automation hungry
    // ═══════════════════════════════════════════════════════════════
    // Almaty
    { city: 'almaty', category: 'логистические компании', vertical: 'logistics' },
    { city: 'almaty', category: 'транспортные компании', vertical: 'logistics' },
    { city: 'almaty', category: 'грузоперевозки', vertical: 'logistics' },
    { city: 'almaty', category: 'складские услуги', vertical: 'logistics' },
    { city: 'almaty', category: 'курьерские службы', vertical: 'logistics' },
    { city: 'almaty', category: 'экспедиторские компании', vertical: 'logistics' },
    // Astana
    { city: 'astana', category: 'логистические компании', vertical: 'logistics' },
    { city: 'astana', category: 'транспортные компании', vertical: 'logistics' },
    { city: 'astana', category: 'грузоперевозки', vertical: 'logistics' },

    // ═══════════════════════════════════════════════════════════════
    // REAL ESTATE - Have contacts, good budget
    // ═══════════════════════════════════════════════════════════════
    // Almaty
    { city: 'almaty', category: 'застройщики', vertical: 'realestate' },
    { city: 'almaty', category: 'агентства недвижимости', vertical: 'realestate' },
    { city: 'almaty', category: 'строительные компании', vertical: 'realestate' },
    { city: 'almaty', category: 'девелоперы', vertical: 'realestate' },
    // Astana
    { city: 'astana', category: 'застройщики', vertical: 'realestate' },
    { city: 'astana', category: 'агентства недвижимости', vertical: 'realestate' },
    { city: 'astana', category: 'строительные компании', vertical: 'realestate' },
];

export class TwoGISScraper implements DiscoveryAdapter {
    readonly name = '2gis';
    readonly source: LeadSource = 'scrape';

    private baseUrl = 'https://2gis.kz';
    private maxCompaniesPerCategory = 30;

    /**
     * Decode 2GIS masked URLs
     * 2GIS wraps external links as: https://link.2gis.com/4.2/HASH/BASE64_ENCODED_URL
     * The decoded content may contain tracking data after newlines, so we only take the first line
     */
    private decode2GISUrl(maskedUrl: string): string {
        if (!maskedUrl || !maskedUrl.includes('link.2gis.com')) {
            return maskedUrl;
        }

        // 2GIS URLs have format: link.2gis.com/VERSION/HASH/BASE64
        // The base64 is always the LAST segment
        try {
            const parts = maskedUrl.split('/');
            let lastPart = parts[parts.length - 1];

            // First, URL-decode the base64 string (2GIS uses URL-safe encoding)
            try {
                lastPart = decodeURIComponent(lastPart);
            } catch {
                // Not URL-encoded, continue
            }

            // Check if it looks like base64 (including URL-safe base64 chars)
            if (lastPart && lastPart.match(/^[A-Za-z0-9+/=_-]+$/)) {
                // Try standard base64 first, then URL-safe
                let decoded = '';
                try {
                    decoded = Buffer.from(lastPart, 'base64').toString('utf-8');
                } catch {
                    // Try URL-safe base64 (replace - with + and _ with /)
                    const standard = lastPart.replace(/-/g, '+').replace(/_/g, '/');
                    decoded = Buffer.from(standard, 'base64').toString('utf-8');
                }

                // Remove null characters and trim
                const clean = decoded.replace(/\0/g, '').trim();

                // The decoded content may have multiple lines:
                // Line 1: actual URL
                // Line 2+: tracking data (https://s1.bss.2gis.com/..., JSON, etc.)
                // We only want the first line that starts with http
                const lines = clean.split('\n');
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('http') && !trimmed.includes('bss.2gis.com')) {
                        return trimmed;
                    }
                }

                // Fallback: if the whole thing starts with http, return it
                if (clean.startsWith('http') && !clean.includes('bss.2gis.com')) {
                    return clean.split('\n')[0].trim();
                }
            }
        } catch {
            // Fall through
        }
        return maskedUrl;
    }

    async isReady(): Promise<boolean> {
        const browser = await gateway.getBrowser();
        if (!browser) return false;
        await browser.close();
        return true;
    }

    async discover(): Promise<DiscoveredLead[]> {
        const browser = await gateway.getBrowser();
        if (!browser) {
            console.log('[2GIS] Browser not available');
            return [];
        }

        const leads: DiscoveredLead[] = [];
        const seenCompanies = new Set<string>();
        let page: BrowserPage | null = null;

        try {
            page = await browser.newPage();

            for (const target of TARGET_CATEGORIES) {
                try {
                    const companies = await this.scrapeCategory(page, target.city, target.category);
                    console.log(`[2GIS] Found ${companies.length} companies in ${target.city}/${target.category}`);

                    for (const company of companies) {
                        // Dedupe by name
                        const key = company.name.toLowerCase();
                        if (seenCompanies.has(key)) continue;
                        seenCompanies.add(key);

                        const lead = this.companyToLead(company, target);
                        if (lead) {
                            leads.push(lead);
                        }
                    }
                } catch (error) {
                    console.error(`[2GIS] Error scraping ${target.city}/${target.category}:`, error);
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
    ): Promise<Company2GIS[]> {
        // 2GIS URL format: https://2gis.kz/almaty/search/it-компании
        const searchUrl = `${this.baseUrl}/${city}/search/${encodeURIComponent(category)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

        // Wait for search results container to load - try multiple selectors
        let foundResults = false;
        try {
            await page.waitForSelector('div._zjunba', { timeout: 15000 });
            foundResults = true;
        } catch (e) {
            console.log(`[2GIS] Primary selector failed, trying fallback...`);
            try {
                await page.waitForSelector('a._1rehek', { timeout: 10000 });
                foundResults = true;
            } catch {
                console.log(`[2GIS] No results at ${searchUrl}`);
            }
        }

        if (!foundResults) return [];

        // Extra wait for dynamic content
        await page.waitForTimeout(3000);

        // Get all company firm IDs from the list
        const companyLinks = await page.evaluate(() => {
            const links: { name: string; firmId: string }[] = [];
            const cards = document.querySelectorAll('div._zjunba a._1rehek');
            cards.forEach(link => {
                const href = link.getAttribute('href') || '';
                const match = href.match(/\/firm\/(\d+)/);
                const name = link.textContent?.trim() || '';
                if (match && name.length > 2) {
                    links.push({ name, firmId: match[1] });
                }
            });
            return links.slice(0, 12); // Limit to 12 per category
        });

        const results: Company2GIS[] = [];

        // Click each company to get contact details
        for (const company of companyLinks) {
            try {
                // Navigate directly to company page using firm ID
                const firmUrl = `${this.baseUrl}/${city}/firm/${company.firmId}`;
                await page.goto(firmUrl, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(1500);

                // Try to click "Show phone" button
                try {
                    const showPhoneBtn = await page.$('button._1tkj2hw, button[class*="phone"]');
                    if (showPhoneBtn) {
                        await showPhoneBtn.click();
                        await page.waitForTimeout(1000);
                    }
                } catch {
                    // Button may not exist for all companies
                }

                // SCROLL DOWN the sidebar to load all contact info (social media links are at bottom)
                try {
                    // Find the scrollable sidebar container and scroll it
                    await page.evaluate(() => {
                        const sidebar = document.querySelector('div._1kf6gff') ||
                            document.querySelector('div[class*="scroll"]') ||
                            document.querySelector('aside');
                        if (sidebar) {
                            sidebar.scrollTop = sidebar.scrollHeight;
                        }
                        // Also try window scroll
                        window.scrollBy(0, 1000);
                    });
                    await page.waitForTimeout(500);
                    // Scroll again to make sure all is loaded
                    await page.evaluate(() => {
                        const sidebar = document.querySelector('div._1kf6gff') ||
                            document.querySelector('div[class*="scroll"]') ||
                            document.querySelector('aside');
                        if (sidebar) {
                            sidebar.scrollTop = sidebar.scrollHeight;
                        }
                    });
                    await page.waitForTimeout(500);
                } catch {
                    // Scroll may fail on some pages
                }

                // Extract ALL details from company page
                const details = await page.evaluate(() => {
                    // Get phone (look for tel: links or bdo elements)
                    let phone = '';
                    const telLink = document.querySelector('a[href^="tel:"]');
                    if (telLink) {
                        phone = telLink.getAttribute('href')?.replace('tel:', '') || '';
                        if (!phone) phone = telLink.textContent?.trim() || '';
                    }
                    const bdoEl = document.querySelector('bdo');
                    if (!phone && bdoEl) phone = bdoEl.textContent?.trim() || '';

                    // Get address
                    let address = '';
                    const allDivs = Array.from(document.querySelectorAll('div'));
                    const addressDiv = allDivs.find(d =>
                        d.textContent?.includes('Улица') ||
                        d.textContent?.includes('ул.') ||
                        d.textContent?.includes('пр-т')
                    );
                    if (addressDiv) address = addressDiv.textContent?.trim() || '';

                    // Get all links for website and social media
                    let website = '';
                    let instagram = '';
                    let whatsapp = '';
                    let telegram = '';
                    let email = '';

                    const allLinks = document.querySelectorAll('a[href]');
                    allLinks.forEach(link => {
                        const href = link.getAttribute('href') || '';
                        const text = link.textContent?.toLowerCase() || '';

                        // 2GIS wraps all external links as link.2gis.com/xxx/BASE64
                        // Capture these and we'll decode them outside evaluate()

                        // Website: look for link.2gis.com URLs near website-like text
                        if (href.includes('link.2gis.com') && !website) {
                            // Not social media based on surrounding text
                            if (!text.includes('instagram') && !text.includes('whatsapp') &&
                                !text.includes('telegram') && !text.includes('facebook')) {
                                website = href;
                            }
                        }
                        // Direct non-2gis http links (rare but possible)
                        if (href.startsWith('http') && !href.includes('2gis.') &&
                            !href.includes('instagram') && !href.includes('whatsapp') &&
                            !href.includes('t.me') && !href.includes('facebook') &&
                            !href.includes('vk.com') && !href.includes('google') && !website) {
                            website = href;
                        }

                        // Instagram: masked link OR direct link
                        if ((href.includes('instagram.com') ||
                            (href.includes('link.2gis.com') && text.includes('instagram'))) && !instagram) {
                            instagram = href;
                        }

                        // WhatsApp: masked link OR direct link
                        if ((href.includes('wa.me') || href.includes('whatsapp') ||
                            (href.includes('link.2gis.com') && text.includes('whatsapp'))) && !whatsapp) {
                            whatsapp = href;
                        }

                        // Telegram: masked link OR direct link
                        if ((href.includes('t.me') ||
                            (href.includes('link.2gis.com') && text.includes('telegram'))) && !telegram) {
                            telegram = href;
                        }

                        // Email (not masked)
                        if (href.startsWith('mailto:') && !email) {
                            email = href.replace('mailto:', '');
                        }
                    });

                    // Get rubric/category
                    let rubric = '';
                    const rubricLinks = document.querySelectorAll('a._1rehek');
                    if (rubricLinks.length > 0) {
                        rubric = rubricLinks[0].textContent?.trim() || '';
                    }

                    return { phone, address, website, instagram, whatsapp, telegram, email, rubric };
                });

                // Decode 2GIS masked URLs (they use base64-encoded redirects)
                const decodedWebsite = this.decode2GISUrl(details.website);
                const decodedInstagram = this.decode2GISUrl(details.instagram);
                const decodedWhatsapp = this.decode2GISUrl(details.whatsapp);
                const decodedTelegram = this.decode2GISUrl(details.telegram);

                // If company has a website, scrape it for more contacts
                let websiteContacts: {
                    emails: string[];
                    phones: string[];
                    instagram?: string;
                    whatsapp?: string;
                    telegram?: string;
                    facebook?: string;
                    youtube?: string;
                } = {
                    emails: [],
                    phones: [],
                };

                if (decodedWebsite && decodedWebsite.startsWith('http')) {
                    websiteContacts = await this.scrapeWebsite(page, decodedWebsite);
                    // Navigate back to 2GIS for next company
                    await page.goto(`${this.baseUrl}/${city}/search/${encodeURIComponent(category)}`, { waitUntil: 'domcontentloaded' });
                    await page.waitForTimeout(1000);
                }

                results.push({
                    name: company.name,
                    phone: details.phone || undefined,
                    address: details.address,
                    website: decodedWebsite || undefined,  // Use decoded URL
                    // Merge: prefer website data, fallback to 2GIS (decoded)
                    instagram: websiteContacts.instagram || decodedInstagram || undefined,
                    whatsapp: websiteContacts.whatsapp || decodedWhatsapp || undefined,
                    telegram: websiteContacts.telegram || decodedTelegram || undefined,
                    email: details.email || undefined,
                    category: details.rubric,
                    // New fields from website
                    allEmails: websiteContacts.emails,
                    allPhones: websiteContacts.phones,
                    facebook: websiteContacts.facebook,
                    youtube: websiteContacts.youtube,
                });

                const contacts = [
                    details.phone && 'phone',
                    decodedWebsite && 'web',
                    (websiteContacts.instagram || decodedInstagram) && 'ig',
                    (websiteContacts.whatsapp || decodedWhatsapp) && 'wa',
                    (websiteContacts.telegram || decodedTelegram) && 'tg',
                    details.email && 'email',
                    websiteContacts.emails.length > 0 && `+${websiteContacts.emails.length}emails`,
                    websiteContacts.phones.length > 0 && `+${websiteContacts.phones.length}phones`,
                    websiteContacts.facebook && 'fb',
                    websiteContacts.youtube && 'yt',
                ].filter(Boolean).join(', ');
                console.log(`[2GIS] Got ${company.name}: ${contacts || 'no contacts'}`);

            } catch (err) {
                console.log(`[2GIS] Error on ${company.name}: ${(err as Error).message || err}`);
            }
        }

        return results;
    }

    /**
     * Scrape contact info from company website
     * Visits the website, looks for emails, phones, and social links
     */
    private async scrapeWebsite(page: BrowserPage, websiteUrl: string): Promise<{
        emails: string[];
        phones: string[];
        instagram?: string;
        whatsapp?: string;
        telegram?: string;
        facebook?: string;
        youtube?: string;
    }> {
        const result = {
            emails: [] as string[],
            phones: [] as string[],
            instagram: undefined as string | undefined,
            whatsapp: undefined as string | undefined,
            telegram: undefined as string | undefined,
            facebook: undefined as string | undefined,
            youtube: undefined as string | undefined,
        };

        try {
            // Navigate to website with timeout
            await page.goto(websiteUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);

            // Scroll to footer to load lazy content
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(1000);

            // Extract all contact info
            const contacts = await page.evaluate(() => {
                const emails: string[] = [];
                const phones: string[] = [];
                let instagram = '', whatsapp = '', telegram = '', facebook = '', youtube = '';

                // Get all links
                const links = Array.from(document.querySelectorAll('a'));

                for (const link of links) {
                    const href = link.href || '';
                    const text = link.textContent?.trim() || '';

                    // Emails
                    if (href.startsWith('mailto:')) {
                        const email = href.replace('mailto:', '').split('?')[0];
                        if (email && !emails.includes(email)) emails.push(email);
                    }

                    // Phones
                    if (href.startsWith('tel:')) {
                        const phone = href.replace('tel:', '').replace(/\s/g, '');
                        if (phone && !phones.includes(phone)) phones.push(phone);
                    }

                    // Social media
                    if (href.includes('instagram.com') && !instagram) instagram = href;
                    if (href.includes('wa.me') || href.includes('whatsapp.com') || href.includes('api.whatsapp')) {
                        if (!whatsapp) whatsapp = href;
                    }
                    if (href.includes('t.me') || href.includes('telegram.me')) {
                        if (!telegram) telegram = href;
                    }
                    if (href.includes('facebook.com') && !facebook) facebook = href;
                    if (href.includes('youtube.com') && !youtube) youtube = href;
                }

                // Also look for email patterns in text (not just links)
                const bodyText = document.body.innerText || '';
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const foundEmails = bodyText.match(emailRegex) || [];
                for (const email of foundEmails) {
                    if (!emails.includes(email) && !email.includes('example.com')) {
                        emails.push(email);
                    }
                }

                // Look for phone patterns
                const phoneRegex = /\+7[\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}/g;
                const foundPhones = bodyText.match(phoneRegex) || [];
                for (const phone of foundPhones) {
                    const cleaned = phone.replace(/[\s\-\(\)]/g, '');
                    if (!phones.includes(cleaned)) phones.push(cleaned);
                }

                return { emails, phones, instagram, whatsapp, telegram, facebook, youtube };
            });

            result.emails = contacts.emails.slice(0, 5); // Limit to 5 emails
            result.phones = contacts.phones.slice(0, 5); // Limit to 5 phones
            result.instagram = contacts.instagram || undefined;
            result.whatsapp = contacts.whatsapp || undefined;
            result.telegram = contacts.telegram || undefined;
            result.facebook = contacts.facebook || undefined;
            result.youtube = contacts.youtube || undefined;

            console.log(`[2GIS] Website ${websiteUrl}: ${result.emails.length} emails, ${result.phones.length} phones`);

        } catch (err) {
            console.log(`[2GIS] Website scrape failed for ${websiteUrl}: ${(err as Error).message}`);
        }

        return result;
    }

    private companyToLead(
        company: Company2GIS,
        target: { city: string; category: string }
    ): DiscoveredLead | null {
        if (!company.name) return null;

        return {
            firstName: 'Директор',  // Generic - will be enriched
            lastName: company.name,
            companyName: company.name,
            phone: company.phone,
            jobTitle: 'Руководитель',
            signals: [
                `2gis_${target.category}`,
                target.city,
                company.rating && company.rating >= 4 ? 'high_rated' : '',
                company.whatsapp ? 'has_whatsapp' : '',
                company.instagram ? 'has_instagram' : '',
                company.telegram ? 'has_telegram' : '',
            ].filter(Boolean) as string[],
            rawData: {
                source: '2gis',
                city: target.city,
                category: target.category,
                address: company.address,
                website: company.website,
                instagram: company.instagram,
                whatsapp: company.whatsapp,
                telegram: company.telegram,
                email: company.email,
                rating: company.rating,
                // Data from website scraping
                allEmails: company.allEmails,
                allPhones: company.allPhones,
                facebook: company.facebook,
                youtube: company.youtube,
            },
        };
    }
}

// Singleton
export const twoGISScraper = new TwoGISScraper();
