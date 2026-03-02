/**
 * Website Analyzer for Leads
 * Analyzes lead websites and generates personalized reports
 * Used as irresistible offer: "We found 5 issues on your site..."
 */
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';
import type { Lead } from './types.js';

interface WebsiteAnalysis {
    url: string;
    loadTime: number;
    issues: Issue[];
    score: number;
    summary: string;
}

interface Issue {
    category: 'speed' | 'mobile' | 'seo' | 'ux' | 'security';
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
}

async function analyzeWebsite(page: Page, url: string): Promise<WebsiteAnalysis> {
    const issues: Issue[] = [];
    let loadTime = 0;

    try {
        // Normalize URL
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }

        console.log(`   Analyzing: ${url}`);

        // Measure load time
        const startTime = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        loadTime = Date.now() - startTime;

        // Check load time
        if (loadTime > 5000) {
            issues.push({
                category: 'speed',
                severity: 'critical',
                title: 'Медленная загрузка сайта',
                description: `Сайт загружается ${(loadTime / 1000).toFixed(1)} секунд. Оптимально — менее 3 секунд.`
            });
        } else if (loadTime > 3000) {
            issues.push({
                category: 'speed',
                severity: 'warning',
                title: 'Загрузка сайта может быть быстрее',
                description: `Текущее время загрузки: ${(loadTime / 1000).toFixed(1)} сек. Рекомендуем оптимизировать.`
            });
        }

        // Check viewport meta (mobile-friendly)
        const hasViewport = await page.evaluate(() => {
            const viewport = document.querySelector('meta[name="viewport"]');
            return !!viewport;
        });

        if (!hasViewport) {
            issues.push({
                category: 'mobile',
                severity: 'critical',
                title: 'Сайт не адаптирован под мобильные устройства',
                description: 'Отсутствует viewport meta-тег. 60%+ трафика сегодня — с мобильных.'
            });
        }

        // Check SEO basics
        const seoData = await page.evaluate(() => {
            const title = document.querySelector('title')?.textContent || '';
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const h1 = document.querySelector('h1')?.textContent || '';
            const images = document.querySelectorAll('img');
            let imagesWithoutAlt = 0;
            images.forEach(img => {
                if (!img.getAttribute('alt')) imagesWithoutAlt++;
            });

            return { title, metaDesc, h1, imagesWithoutAlt, imageCount: images.length };
        });

        if (!seoData.title || seoData.title.length < 10) {
            issues.push({
                category: 'seo',
                severity: 'critical',
                title: 'Отсутствует или слишком короткий title',
                description: 'Title — один из главных факторов ранжирования в Google/Яндекс.'
            });
        }

        if (!seoData.metaDesc) {
            issues.push({
                category: 'seo',
                severity: 'warning',
                title: 'Отсутствует meta description',
                description: 'Описание отображается в результатах поиска. Без него — ниже CTR.'
            });
        }

        if (!seoData.h1) {
            issues.push({
                category: 'seo',
                severity: 'warning',
                title: 'Отсутствует заголовок H1',
                description: 'H1 помогает поисковикам понять тему страницы.'
            });
        }

        if (seoData.imagesWithoutAlt > 0) {
            issues.push({
                category: 'seo',
                severity: 'info',
                title: `${seoData.imagesWithoutAlt} изображений без alt-текста`,
                description: 'Alt-тексты улучшают доступность и SEO.'
            });
        }

        // Check HTTPS
        if (url.startsWith('http://')) {
            issues.push({
                category: 'security',
                severity: 'critical',
                title: 'Сайт работает без HTTPS',
                description: 'Браузеры помечают такие сайты как "небезопасные". Теряете доверие клиентов.'
            });
        }

        // Check for contact forms / CTAs
        const hasContactForm = await page.evaluate(() => {
            const forms = document.querySelectorAll('form');
            const buttons = document.querySelectorAll('button, .btn, [class*="button"]');
            return forms.length > 0 || buttons.length > 0;
        });

        if (!hasContactForm) {
            issues.push({
                category: 'ux',
                severity: 'warning',
                title: 'Нет явного призыва к действию',
                description: 'Не нашёл форму обратной связи или кнопку на главной странице.'
            });
        }

        // Check for WhatsApp/Telegram
        const hasMessengers = await page.evaluate(() => {
            const html = document.body.innerHTML.toLowerCase();
            return html.includes('whatsapp') || html.includes('telegram') || html.includes('wa.me');
        });

        if (!hasMessengers) {
            issues.push({
                category: 'ux',
                severity: 'info',
                title: 'Нет интеграции с мессенджерами',
                description: 'WhatsApp/Telegram кнопки увеличивают конверсию на 20-30%.'
            });
        }

    } catch (error) {
        issues.push({
            category: 'speed',
            severity: 'critical',
            title: 'Сайт недоступен или не отвечает',
            description: 'Не удалось загрузить страницу. Возможны проблемы с хостингом.'
        });
    }

    // Calculate score
    let score = 100;
    for (const issue of issues) {
        if (issue.severity === 'critical') score -= 20;
        else if (issue.severity === 'warning') score -= 10;
        else score -= 5;
    }
    score = Math.max(0, score);

    // Generate summary
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    let summary = '';
    if (criticalCount > 0) {
        summary = `Обнаружено ${criticalCount} критических проблем, требующих немедленного внимания.`;
    } else if (warningCount > 0) {
        summary = `Сайт работает, но есть ${warningCount} улучшений для повышения эффективности.`;
    } else {
        summary = 'Сайт в хорошем состоянии. Есть небольшие рекомендации.';
    }

    return { url, loadTime, issues, score, summary };
}

function generateReportMessage(lead: Lead, analysis: WebsiteAnalysis): string {
    const criticalIssues = analysis.issues.filter(i => i.severity === 'critical');
    const warningIssues = analysis.issues.filter(i => i.severity === 'warning');

    let issuesList = '';

    // Show top 3 issues
    const topIssues = [...criticalIssues, ...warningIssues].slice(0, 3);
    topIssues.forEach((issue, i) => {
        issuesList += `${i + 1}. ${issue.title}\n`;
    });

    const message = `Добрый день.

Провёл экспресс-анализ вашего сайта ${analysis.url}

Результат: ${analysis.score}/100 баллов

Обнаружено:
${issuesList}
${analysis.summary}

Готов выслать полный отчёт с рекомендациями по исправлению.

Интересно?`;

    return message;
}

async function analyzeLeads(limit: number = 5): Promise<void> {
    await leads.connect();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });
    const page = await context.newPage();

    // Get leads with websites
    const allLeads = await leads.getByState('discovered');
    const leadsWithSites = allLeads.filter(l => l.website);

    console.log('\n=== WEBSITE ANALYSIS FOR LEADS ===\n');
    console.log(`Found ${leadsWithSites.length} leads with websites\n`);

    for (const lead of leadsWithSites.slice(0, limit)) {
        console.log(`\nCompany: ${lead.companyName}`);

        const analysis = await analyzeWebsite(page, lead.website!);

        console.log(`   Score: ${analysis.score}/100`);
        console.log(`   Issues: ${analysis.issues.length}`);

        // Generate personalized message
        const message = generateReportMessage(lead, analysis);

        console.log('\n--- OUTREACH MESSAGE ---');
        console.log(message);
        console.log('------------------------\n');

        // Save analysis to lead notes
        await leads.update(lead.id, {
            notes: [
                ...(lead.notes || []),
                `Website Score: ${analysis.score}/100`,
                `Issues: ${analysis.issues.map(i => i.title).join('; ')}`
            ]
        });

        await page.waitForTimeout(1000);
    }

    await browser.close();
    await leads.disconnect();
}

export const websiteAnalyzer = {
    analyzeWebsite,
    generateReportMessage,
    analyzeLeads
};

// Run
analyzeLeads(5).catch(console.error);
