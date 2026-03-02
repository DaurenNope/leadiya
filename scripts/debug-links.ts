/**
 * Debug: What links ARE on a company page?
 */
import { chromium } from 'playwright';

async function debugCompanyLinks() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Try IT companies which usually have websites
    const searchUrl = 'https://2gis.kz/almaty/search/IT%20%D0%BA%D0%BE%D0%BC%D0%BF%D0%B0%D0%BD%D0%B8%D0%B8';
    console.log('Opening search:', searchUrl);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Click first company
    await page.click('[data-name="CardCatalog"] a');
    await page.waitForTimeout(3000);

    console.log('Current URL:', page.url());

    // Get ALL links
    const allLinks = await page.evaluate(() => {
        const results: string[] = [];
        document.querySelectorAll('a[href]').forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.trim().substring(0, 40) || '';
            // Only external links or social
            if (href.includes('link.2gis.com') ||
                href.includes('instagram') || href.includes('telegram') ||
                href.includes('whatsapp') || href.includes('facebook') ||
                (href.startsWith('http') && !href.includes('2gis.kz'))) {
                results.push(`${text} -> ${href.substring(0, 70)}`);
            }
        });
        return results;
    });

    console.log('\n=== External/Social links found ===');
    if (allLinks.length === 0) {
        console.log('NONE FOUND');
    } else {
        allLinks.forEach(l => console.log(l));
    }

    await browser.close();
}

debugCompanyLinks().catch(console.error);
