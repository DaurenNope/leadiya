/**
 * MAXIMIZED test v3: Fixed social link extraction
 * 2GIS wraps social links through link.2gis.com redirects.
 * We identify them by aria-label/text and decode the base64 target URL.
 * 
 * WORKAROUND for tsx __name issue: We inject a helper script into the 
 * page context first, then call it from page.evaluate.
 */
import 'dotenv/config';
import { chromium, type Page } from 'playwright';

// Inject helper functions into the page before evaluating
async function injectHelpers(page: Page) {
    await page.evaluate(() => {
        // @ts-ignore - attach to window so it persists
        (window as any).__decodeRedirect = function (href: string) {
            if (!href.includes('link.2gis.com')) return href;
            try {
                var parts = href.split('/');
                var payload = parts[parts.length - 1];
                var decoded = atob(decodeURIComponent(payload).split('\n')[0]);
                return decoded;
            } catch (e) {
                return href;
            }
        };
    });
}

async function scrapeMaxDetail(page: Page): Promise<Record<string, any>> {
    // Click "Показать телефоны" to reveal hidden phones
    try {
        const showPhonesBtn = await page.$('button:has-text("Показать телефон")');
        if (showPhonesBtn) {
            await showPhonesBtn.click();
            await page.waitForTimeout(1500);
        }
    } catch { }

    // Inject the URL decoder helper
    await injectHelpers(page);

    return page.evaluate(() => {
        const decode = (window as any).__decodeRedirect;
        const body = document.body?.textContent || '';

        // ═══ PHONES ═══
        const phones: string[] = [];
        document.querySelectorAll('a[href^="tel:"]').forEach(a => {
            const digits = (a as HTMLAnchorElement).href.replace('tel:', '').replace(/\D/g, '');
            if (digits.length >= 10 && !phones.includes(digits)) phones.push(digits);
        });
        const pm = body.match(/[\+]?[78][\s\-‒–]?\(?\d{3}\)?[\s\-‒–]?\d{3}[\s\-‒–]?\d{2}[\s\-‒–]?\d{2}/g);
        if (pm) pm.forEach(p => {
            const d = p.replace(/\D/g, '');
            if (d.length >= 10 && !phones.includes(d)) phones.push(d);
        });

        // ═══ EMAILS ═══
        const emails: string[] = [];
        document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
            const email = (a as HTMLAnchorElement).href.replace('mailto:', '').split('?')[0].trim();
            if (email && !emails.includes(email)) emails.push(email);
        });

        // ═══ SOCIAL — match by aria-label, decode base64 redirect ═══
        let instagram = '', whatsapp = '', telegram = '', facebook = '', website = '';

        const links = Array.from(document.querySelectorAll('a[href]'));
        for (let i = 0; i < links.length; i++) {
            const a = links[i] as HTMLAnchorElement;
            const href = a.href;
            const label = (a.getAttribute('aria-label') || a.textContent || '').toLowerCase().trim();

            if (label.includes('instagram') && !instagram) {
                instagram = decode(href);
            } else if (label.includes('whatsapp') && !whatsapp) {
                whatsapp = decode(href);
            } else if (label.includes('telegram') && !telegram) {
                telegram = decode(href);
            } else if (label.includes('facebook') && !facebook) {
                facebook = decode(href);
            }
        }

        // Website: look for labeled link or direct external
        for (let i = 0; i < links.length; i++) {
            if (website) break;
            const a = links[i] as HTMLAnchorElement;
            const label = (a.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('сайт') || label.includes('website')) {
                website = decode(a.href);
            } else if (!a.href.includes('2gis') && !a.href.includes('link.2gis.com') &&
                a.href.startsWith('http') && !a.href.includes('google') && !a.href.includes('yandex') &&
                !a.href.includes('apple.com') && !a.href.includes('play.google')) {
                website = a.href;
            }
        }

        // ═══ ADDRESS ═══
        let address = '';
        const addrMatch = body.match(/(ул\.|улица|пр\.|просп\.|мкр\.|бул\.|пер\.|наб\.)[\s\S]{3,80}/i);
        if (addrMatch) address = addrMatch[0].split('\n')[0].trim().substring(0, 80);

        // ═══ REVIEWS ═══
        const reviewMatch = body.match(/(\d+)\s*(?:отзыв|оценк)/i);
        const reviewCount = reviewMatch ? parseInt(reviewMatch[1]) : 0;

        // ═══ HOURS ═══
        let hours = '';
        const hoursMatch = body.match(/(Ежедневно|Круглосуточно|Пн[\s–\-]+(?:Вс|Пт|Сб))/);
        if (hoursMatch) {
            const idx = body.indexOf(hoursMatch[0]);
            const block = body.substring(idx, idx + 60);
            // Extract the time part: "Ежедневно с 11:00 до 02:00" or "Круглосуточно"
            const timeMatch = block.match(/(Ежедневно|Круглосуточно|Пн[\s–\-]+\S+)\s*(с\s*\d{1,2}:\d{2}\s*до\s*\d{1,2}:\d{2})?/);
            hours = timeMatch ? timeMatch[0].trim() : hoursMatch[0];
        }

        // ═══ FEATURES ═══
        const featureRe = /(Wi-Fi|парковка|доставка|самовывоз|бронирование|кальян|live|банкет|VIP|караоке|завтрак|ланч|бизнес-ланч|летняя веранда)/gi;
        const features = [...new Set((body.match(featureRe) || []).map((f: string) => f.toLowerCase()))];

        return {
            phones, emails, instagram, whatsapp, telegram, facebook, website,
            address, reviewCount, hours, features,
        };
    });
}

async function main() {
    console.log('🚀 MAXIMIZED v3: 2GIS Almaty → рестораны');
    console.log('🔧 aria-label matching + base64 URL decoding\n');

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto('https://2gis.kz/almaty/search/рестораны', {
        waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const firmEntries = await page.evaluate(() => {
        const entries: { name: string; href: string }[] = [];
        const seen = new Set<string>();
        document.querySelectorAll('a[href*="/firm/"]').forEach(link => {
            const href = (link as HTMLAnchorElement).href;
            const name = link.textContent?.trim() || '';
            if (name && name.length > 1 && !seen.has(href)) {
                seen.add(href);
                entries.push({ name, href });
            }
        });
        return entries;
    });

    console.log(`Found ${firmEntries.length} companies. Deep scanning...\n`);

    const stats = { phones: 0, emails: 0, websites: 0, instagram: 0, whatsapp: 0, telegram: 0, reviews: 0, hours: 0, features: 0 };

    for (let i = 0; i < firmEntries.length; i++) {
        const entry = firmEntries[i];
        process.stdout.write(`[${i + 1}/${firmEntries.length}] ${entry.name.padEnd(25)} `);

        try {
            await page.goto(entry.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(2000);

            const d = await scrapeMaxDetail(page);

            // Compact line
            const parts: string[] = [];
            if (d.phones.length) parts.push(`📞${d.phones.length}`);
            if (d.emails.length) parts.push(`📧${d.emails.length}`);
            if (d.website) parts.push('🌐');
            if (d.instagram) parts.push('📸IG');
            if (d.whatsapp) parts.push('💬WA');
            if (d.telegram) parts.push('✈️TG');
            if (d.reviewCount) parts.push(`⭐${d.reviewCount}`);
            if (d.hours) parts.push('🕐');
            if (d.features.length) parts.push(`🏷️${d.features.length}`);
            console.log(parts.join(' | '));

            // Show decoded social URLs (to verify)
            if (d.instagram) console.log(`   IG: ${d.instagram.substring(0, 60)}`);
            if (d.whatsapp) console.log(`   WA: ${d.whatsapp.substring(0, 60)}`);
            if (d.telegram) console.log(`   TG: ${d.telegram.substring(0, 60)}`);
            if (d.website) console.log(`   🌐: ${d.website.substring(0, 60)}`);

            if (d.phones.length > 0) stats.phones++;
            if (d.emails.length > 0) stats.emails++;
            if (d.website) stats.websites++;
            if (d.instagram) stats.instagram++;
            if (d.whatsapp) stats.whatsapp++;
            if (d.telegram) stats.telegram++;
            if (d.reviewCount > 0) stats.reviews++;
            if (d.hours) stats.hours++;
            if (d.features.length > 0) stats.features++;

        } catch (err: any) {
            console.log(`⚠️ ${err.message?.substring(0, 50)}`);
        }

        await page.waitForTimeout(800);
    }

    const n = firmEntries.length;
    console.log('\n══════════════════════════════════════════════');
    console.log('📊 MAXIMIZED EXTRACTION RESULTS');
    console.log('══════════════════════════════════════════════');
    console.log(`  📞 Phones:     ${stats.phones}/${n} (${Math.round(stats.phones / n * 100)}%)`);
    console.log(`  📧 Emails:     ${stats.emails}/${n} (${Math.round(stats.emails / n * 100)}%)`);
    console.log(`  🌐 Websites:   ${stats.websites}/${n} (${Math.round(stats.websites / n * 100)}%)`);
    console.log(`  📸 Instagram:  ${stats.instagram}/${n} (${Math.round(stats.instagram / n * 100)}%)`);
    console.log(`  💬 WhatsApp:   ${stats.whatsapp}/${n} (${Math.round(stats.whatsapp / n * 100)}%)`);
    console.log(`  ✈️  Telegram:   ${stats.telegram}/${n} (${Math.round(stats.telegram / n * 100)}%)`);
    console.log(`  ⭐ Reviews:    ${stats.reviews}/${n} (${Math.round(stats.reviews / n * 100)}%)`);
    console.log(`  🕐 Hours:      ${stats.hours}/${n} (${Math.round(stats.hours / n * 100)}%)`);
    console.log(`  🏷️  Features:   ${stats.features}/${n} (${Math.round(stats.features / n * 100)}%)`);

    await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
