/**
 * Website Contact Enrichment
 * Visits each lead's website to find decision-maker contacts
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';

async function scrapeContactPage(page: Page, baseUrl: string): Promise<{
    emails: string[];
    phones: string[];
    names: string[];
}> {
    const results = { emails: [] as string[], phones: [] as string[], names: [] as string[] };

    try {
        let url = baseUrl;
        if (!url.startsWith('http')) url = 'https://' + url;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Find contact-related links
        const contactLinks = await page.evaluate(() => {
            const keywords = ['контакт', 'contact', 'о нас', 'about', 'руковод', 'команда', 'team', 'staff'];
            const links: string[] = [];

            document.querySelectorAll('a').forEach(a => {
                const text = (a.textContent || '' + a.href).toLowerCase();
                if (keywords.some(k => text.includes(k))) {
                    links.push(a.href);
                }
            });

            return [...new Set(links)].slice(0, 3);
        });

        // Visit main page + contact pages
        const pagesToCheck = [page.url(), ...contactLinks];

        for (const pageUrl of pagesToCheck) {
            try {
                if (pageUrl !== page.url()) {
                    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    await page.waitForTimeout(1000);
                }

                const extracted = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const html = document.body.innerHTML;

                    // Find emails - prioritize personal over generic
                    const allEmails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
                    const genericPrefixes = ['info', 'admin', 'support', 'contact', 'mail', 'office', 'sales', 'hr', 'help', 'noreply'];

                    const personalEmails = allEmails.filter(e => {
                        const prefix = e.split('@')[0].toLowerCase();
                        return !genericPrefixes.includes(prefix);
                    });

                    // Find phones
                    const phones = text.match(/\+7[\s\d()-]{10,}/g) || [];
                    const cleanedPhones = phones.map(p => p.replace(/[\s()-]/g, ''));

                    // Find names near leadership keywords
                    const leaderPatterns = [
                        /(?:Ректор|Директор|Руководитель|Президент|CEO|Founder|Глава|Председатель)[\s:–—-]+([А-ЯЁA-Z][а-яёa-z]+\s+[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)/gi,
                    ];

                    const names: string[] = [];
                    for (const pattern of leaderPatterns) {
                        let match;
                        while ((match = pattern.exec(text)) !== null) {
                            if (match[1]) names.push(match[1].trim());
                        }
                    }

                    return {
                        emails: [...new Set(personalEmails)].slice(0, 5),
                        phones: [...new Set(cleanedPhones)].slice(0, 5),
                        names: [...new Set(names)].slice(0, 3)
                    };
                });

                results.emails.push(...extracted.emails);
                results.phones.push(...extracted.phones);
                results.names.push(...extracted.names);

            } catch { }
        }

        // Dedupe
        results.emails = [...new Set(results.emails)];
        results.phones = [...new Set(results.phones)];
        results.names = [...new Set(results.names)];

    } catch (error) {
        // Site unreachable
    }

    return results;
}

async function main() {
    console.log('🌐 Website Contact Enrichment\n');

    await leads.connect();
    const allLeads = await leads.getAll();

    // Filter to leads that have emails (meaning they have a working domain)
    const leadsWithDomain = allLeads.filter(l => l.email && l.email.includes('@'));

    console.log(`📊 Processing ${leadsWithDomain.length} leads with known domains...\n`);

    const browser: Browser = await chromium.launch({
        headless: false,
        args: ['--no-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        locale: 'ru-RU'
    });
    const page = await context.newPage();

    let enriched = 0;
    let foundPersonalEmail = 0;
    let foundPhone = 0;
    let foundName = 0;

    for (const lead of leadsWithDomain) {
        // Construct website from email domain
        const domain = lead.email!.split('@')[1];
        const website = `https://${domain}`;

        console.log(`\n🔍 ${lead.companyName?.substring(0, 35)} → ${domain}`);

        const contacts = await scrapeContactPage(page, website);

        const updates: any = {};

        if (contacts.emails.length > 0) {
            console.log(`   📧 Emails: ${contacts.emails.slice(0, 2).join(', ')}`);
            // Prefer first personal email found
            if (!lead.email?.includes(contacts.emails[0])) {
                updates.notes = [...(lead.notes || []), `Personal emails: ${contacts.emails.join(', ')}`];
            }
            foundPersonalEmail++;
        }

        if (contacts.phones.length > 0) {
            console.log(`   📞 Phones: ${contacts.phones.slice(0, 2).join(', ')}`);
            if (!lead.phone) {
                updates.phone = contacts.phones[0];
                updates.whatsappNumber = contacts.phones[0];
            }
            foundPhone++;
        }

        if (contacts.names.length > 0) {
            console.log(`   👤 Leaders: ${contacts.names.join(', ')}`);
            // Update firstName/lastName if found
            const name = contacts.names[0];
            const parts = name.split(/\s+/);
            if (parts.length >= 2) {
                updates.firstName = parts[1] || parts[0];
                updates.lastName = parts[0];
            }
            foundName++;
        }

        if (Object.keys(updates).length > 0) {
            await leads.update(lead.id, updates);
            enriched++;
            console.log(`   ✓ Updated`);
        }

        await page.waitForTimeout(1500);
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 ENRICHMENT COMPLETE`);
    console.log(`${'='.repeat(50)}`);
    console.log(`Leads processed:       ${leadsWithDomain.length}`);
    console.log(`Leads enriched:        ${enriched}`);
    console.log(`Found personal emails: ${foundPersonalEmail}`);
    console.log(`Found phones:          ${foundPhone}`);
    console.log(`Found leader names:    ${foundName}`);

    // Final stats
    const finalLeads = await leads.getAll();
    const withPhone = finalLeads.filter(l => l.phone).length;
    const withEmail = finalLeads.filter(l => l.email).length;

    console.log(`\n📈 FINAL COVERAGE`);
    console.log(`Total leads:    ${finalLeads.length}`);
    console.log(`With phone:     ${withPhone} (${Math.round(withPhone / finalLeads.length * 100)}%)`);
    console.log(`With any email: ${withEmail} (${Math.round(withEmail / finalLeads.length * 100)}%)`);

    await browser.close();
    await leads.disconnect();
}

main().catch(console.error);
