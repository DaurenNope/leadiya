/**
 * Quick test: Scrape ONE company from 2GIS and check if website/social are extracted
 */
import { chromium } from 'playwright';

async function testSingleCompany() {
    console.log('Testing single company scrape...\n');

    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    // Go to a known company with website/social
    const testUrl = 'https://2gis.kz/almaty/search/%D1%80%D0%B5%D1%81%D1%82%D0%BE%D1%80%D0%B0%D0%BD%D1%8B';
    console.log('Opening:', testUrl);
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Click first result
    const firstResult = await page.$('a._1rehek');
    if (firstResult) {
        await firstResult.click();
        await page.waitForTimeout(3000);
    }

    // Extract ALL links
    const links = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll('a[href]').forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim().substring(0, 50) || '';
            if (href.includes('link.2gis.com') ||
                href.includes('instagram') ||
                href.includes('whatsapp') ||
                href.includes('t.me')) {
                results.push(`${href.substring(0, 80)}... | text: "${text}"`);
            }
        });
        return results;
    });

    console.log('\n=== Links found on page ===');
    links.forEach(l => console.log(l));

    // Test decoder
    console.log('\n=== Testing decoder ===');
    for (const link of links) {
        const href = link.split('...')[0];
        if (href.includes('link.2gis.com')) {
            const parts = href.split('/');
            const lastPart = parts[parts.length - 1];
            if (lastPart.match(/^[A-Za-z0-9+/=]+$/)) {
                try {
                    const decoded = Buffer.from(lastPart, 'base64').toString('utf-8').replace(/\0/g, '').trim();
                    console.log('Masked:', href.substring(0, 50));
                    console.log('Decoded:', decoded);
                    console.log('');
                } catch (e) {
                    console.log('Failed to decode:', lastPart);
                }
            }
        }
    }

    await browser.close();
    console.log('\nDone!');
}

testSingleCompany().catch(console.error);
