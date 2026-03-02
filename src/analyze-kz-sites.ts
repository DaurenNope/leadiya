/**
 * Analyze KZ Leads Websites
 */
import { chromium } from 'playwright';
import { leads } from './leads.js';

async function analyzeKZLeads() {
    await leads.connect();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const allLeads = await leads.getByState('discovered');
    const kzLeads = allLeads.filter(l => {
        return l.website &&
            (l.phone?.startsWith('+7') || l.phone?.startsWith('7')) &&
            !l.website.includes('homes.com') &&
            !l.website.includes('greatschools');
    }).slice(0, 5);

    console.log('\n=== KZ WEBSITE ANALYSIS ===\n');

    for (const lead of kzLeads) {
        let url = lead.website!;
        if (!url.startsWith('http')) url = 'https://' + url;

        console.log('Company:', lead.companyName);
        console.log('Phone:', lead.phone);
        console.log('Website:', url);

        try {
            const start = Date.now();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const loadTime = ((Date.now() - start) / 1000).toFixed(1);

            const seo = await page.evaluate(() => {
                const title = document.querySelector('title')?.textContent?.trim() || 'NO TITLE';
                const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || 'NO DESCRIPTION';
                const viewport = !!document.querySelector('meta[name="viewport"]');
                const h1 = document.querySelector('h1')?.textContent?.trim()?.substring(0, 30) || 'NO H1';
                return { title: title.substring(0, 40), desc: desc.substring(0, 40), viewport, h1 };
            });

            const issues: string[] = [];
            if (parseFloat(loadTime) > 3) issues.push('Медленная загрузка (' + loadTime + 's)');
            if (!seo.viewport) issues.push('Не адаптирован под мобильные');
            if (seo.desc === 'NO DESCRIPTION') issues.push('Нет meta description');
            if (!url.startsWith('https')) issues.push('Нет HTTPS');

            console.log('Title:', seo.title);
            console.log('Issues:', issues.length > 0 ? issues.join(', ') : 'None');

            // Generate personalized message
            const msg = `Добрый день.

Провёл экспресс-анализ сайта ${url}

Обнаружено:
${issues.length > 0 ? issues.map((i, n) => (n + 1) + '. ' + i).join('\n') : 'Сайт в хорошем состоянии.'}

Готов выслать полный отчёт с рекомендациями. Без обязательств.

Интересно?`;

            console.log('\n--- MESSAGE ---');
            console.log(msg);
            console.log('---------------\n');

        } catch (e) {
            console.log('ERROR: Site not accessible\n');
        }
    }

    await browser.close();
    await leads.disconnect();
}

analyzeKZLeads();
