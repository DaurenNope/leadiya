/**
 * Debug: WHY are social links and websites not being extracted?
 * Let's dump EVERY link href on the detail page.
 */
import { chromium } from 'playwright';

async function debug() {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Go directly to a restaurant we know has Instagram/WhatsApp
    await page.goto('https://2gis.kz/almaty/search/рестораны', {
        waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // okadzaki.kz — our investigation showed it has Instagram, WhatsApp, Telegram
    const firmLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/firm/"]'));
        return links[0] ? (links[0] as HTMLAnchorElement).href : null;
    });

    if (!firmLink) { await browser.close(); return; }

    console.log('📍 Visiting:', firmLink);
    await page.goto(firmLink, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Dump EVERY single link on the page
    const allLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(a => {
            const el = a as HTMLAnchorElement;
            return {
                href: el.href,
                text: el.textContent?.trim().substring(0, 40) || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                title: el.title || '',
                classes: el.className?.substring(0, 60) || '',
                innerHtml: el.innerHTML?.substring(0, 100) || '',
            };
        });
    });

    // Filter for interesting links
    console.log('\n═══ ALL LINKS ON PAGE ═══');
    console.log(`Total: ${allLinks.length}\n`);

    // Social keyword search
    const socialKeywords = ['instagram', 'whatsapp', 'wa.me', 'telegram', 't.me', 'facebook', 'vk.com', 'youtube', 'tiktok'];
    const socialLinks = allLinks.filter(l =>
        socialKeywords.some(k => l.href.toLowerCase().includes(k) || l.text.toLowerCase().includes(k) || l.ariaLabel.toLowerCase().includes(k))
    );

    console.log('═══ SOCIAL LINKS FOUND ═══');
    socialLinks.forEach(l => {
        console.log(`  href: ${l.href}`);
        console.log(`  text: "${l.text}"`);
        console.log(`  aria: "${l.ariaLabel}"`);
        console.log(`  class: "${l.classes}"`);
        console.log(`  innerHTML: ${l.innerHtml}`);
        console.log('  ---');
    });

    // External links (non-2gis)
    const externalLinks = allLinks.filter(l =>
        l.href.startsWith('http') && !l.href.includes('2gis')
    );

    console.log('\n═══ ALL EXTERNAL LINKS ═══');
    externalLinks.forEach(l => {
        console.log(`  ${l.text.padEnd(30)} ${l.href.substring(0, 80)}`);
    });

    // Check for links with onClick or data attributes that might redirect
    const clickLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[onclick], [data-href], [data-url]')).map(el => ({
            tag: el.tagName,
            onclick: el.getAttribute('onclick')?.substring(0, 80) || '',
            dataHref: el.getAttribute('data-href') || '',
            dataUrl: el.getAttribute('data-url') || '',
            text: el.textContent?.trim().substring(0, 40) || '',
        }));
    });

    console.log('\n═══ CLICK/DATA ELEMENTS ═══');
    clickLinks.forEach(l => console.log(`  ${l.tag} "${l.text}" onclick="${l.onclick}" data-href="${l.dataHref}"`));

    // Check if social links are inside iframes
    const iframes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('iframe')).map(f => f.src);
    });
    console.log('\n═══ IFRAMES ═══');
    iframes.forEach(s => console.log(`  ${s}`));

    // Check for SVG icons that might be social links
    const svgLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a svg, a img')).map(el => {
            const parent = el.closest('a');
            return {
                parentHref: (parent as HTMLAnchorElement)?.href || '',
                alt: (el as HTMLImageElement)?.alt || '',
                src: (el as HTMLImageElement)?.src?.substring(0, 80) || '',
                svg: el.tagName === 'svg' ? 'SVG' : 'IMG',
            };
        });
    });

    console.log('\n═══ SVG/IMG INSIDE LINKS ═══');
    svgLinks.forEach(l => console.log(`  ${l.svg} href: ${l.parentHref.substring(0, 80)} alt: "${l.alt}"`));

    await browser.close();
}

debug().catch(e => { console.error(e); process.exit(1); });
