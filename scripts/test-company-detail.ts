/**
 * Test extraction on COMPANY DETAIL page (what the scraper actually does)
 */
import { chromium } from 'playwright';

async function testCompanyDetail() {
    console.log('Testing company detail page extraction...\n');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Open a specific company that has website/social
    const companyUrl = 'https://2gis.kz/almaty/firm/70000001024555952'; // Schuka restaurant
    console.log('Opening company:', companyUrl);
    await page.goto(companyUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Run the same extraction as the scraper
    const details = await page.evaluate(() => {
        let website = '';
        let instagram = '';
        let whatsapp = '';
        let telegram = '';
        let email = '';

        const allLinks = document.querySelectorAll('a[href]');
        allLinks.forEach(link => {
            const href = link.getAttribute('href') || '';
            const text = link.textContent?.toLowerCase() || '';

            // Website: look for link.2gis.com URLs near website-like text
            if (href.includes('link.2gis.com') && !website) {
                if (!text.includes('instagram') && !text.includes('whatsapp') &&
                    !text.includes('telegram') && !text.includes('facebook')) {
                    website = href;
                }
            }
            // Direct non-2gis http links
            if (href.startsWith('http') && !href.includes('2gis.') &&
                !href.includes('instagram') && !href.includes('whatsapp') &&
                !href.includes('t.me') && !href.includes('facebook') &&
                !href.includes('vk.com') && !href.includes('google') && !website) {
                website = href;
            }

            // Instagram
            if ((href.includes('instagram.com') ||
                (href.includes('link.2gis.com') && text.includes('instagram'))) && !instagram) {
                instagram = href;
            }

            // WhatsApp
            if ((href.includes('wa.me') || href.includes('whatsapp') ||
                (href.includes('link.2gis.com') && text.includes('whatsapp'))) && !whatsapp) {
                whatsapp = href;
            }

            // Telegram
            if ((href.includes('t.me') ||
                (href.includes('link.2gis.com') && text.includes('telegram'))) && !telegram) {
                telegram = href;
            }

            // Email
            if (href.startsWith('mailto:') && !email) {
                email = href.replace('mailto:', '');
            }
        });

        return { website, instagram, whatsapp, telegram, email };
    });

    console.log('\n=== Extracted raw links ===');
    console.log('website:', details.website || '(empty)');
    console.log('instagram:', details.instagram || '(empty)');
    console.log('whatsapp:', details.whatsapp || '(empty)');
    console.log('telegram:', details.telegram || '(empty)');
    console.log('email:', details.email || '(empty)');

    // Decode
    function decode(url: string): string {
        if (!url || !url.includes('link.2gis.com')) return url;
        const parts = url.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart.match(/^[A-Za-z0-9+/=]+$/)) {
            try {
                const decoded = Buffer.from(lastPart, 'base64').toString('utf-8').replace(/\0/g, '').trim();
                if (decoded.startsWith('http')) return decoded;
            } catch { }
        }
        return url;
    }

    console.log('\n=== Decoded ===');
    console.log('website:', decode(details.website) || '(empty)');
    console.log('instagram:', decode(details.instagram) || '(empty)');
    console.log('whatsapp:', decode(details.whatsapp) || '(empty)');
    console.log('telegram:', decode(details.telegram) || '(empty)');

    await browser.close();
    console.log('\nDone!');
}

testCompanyDetail().catch(console.error);
