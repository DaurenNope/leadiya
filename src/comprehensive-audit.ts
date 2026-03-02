/**
 * Comprehensive Website Audit with PDF Report
 * Generates professional reports for leads as irresistible offer
 */
import { chromium, type Page } from 'playwright';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { leads } from './leads.js';
import type { Lead } from './types.js';

interface AuditResult {
    url: string;
    company: string;
    timestamp: Date;
    score: number;
    loadTime: number;
    categories: {
        performance: CategoryResult;
        seo: CategoryResult;
        mobile: CategoryResult;
        security: CategoryResult;
        ux: CategoryResult;
    };
    techStack: string[];
    recommendations: string[];
}

interface CategoryResult {
    score: number;
    issues: Issue[];
}

interface Issue {
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    fix: string;
}

async function runFullAudit(page: Page, url: string, company: string): Promise<AuditResult> {
    const result: AuditResult = {
        url,
        company,
        timestamp: new Date(),
        score: 100,
        loadTime: 0,
        categories: {
            performance: { score: 100, issues: [] },
            seo: { score: 100, issues: [] },
            mobile: { score: 100, issues: [] },
            security: { score: 100, issues: [] },
            ux: { score: 100, issues: [] }
        },
        techStack: [],
        recommendations: []
    };

    try {
        if (!url.startsWith('http')) url = 'https://' + url;

        // Measure load time
        const start = Date.now();
        const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        result.loadTime = Date.now() - start;

        // === PERFORMANCE ===
        if (result.loadTime > 5000) {
            result.categories.performance.issues.push({
                severity: 'critical',
                title: 'Критически медленная загрузка',
                description: `Время загрузки: ${(result.loadTime / 1000).toFixed(1)} секунд`,
                fix: 'Оптимизация изображений, использование CDN, сжатие кода'
            });
            result.categories.performance.score -= 30;
        } else if (result.loadTime > 3000) {
            result.categories.performance.issues.push({
                severity: 'warning',
                title: 'Медленная загрузка страницы',
                description: `Время загрузки: ${(result.loadTime / 1000).toFixed(1)} секунд (рекомендуется < 3с)`,
                fix: 'Оптимизация изображений и скриптов'
            });
            result.categories.performance.score -= 15;
        }

        // Check page size and resources
        const metrics = await page.evaluate(() => {
            const resources = performance.getEntriesByType('resource');
            let totalSize = 0;
            let imageCount = 0;
            let jsCount = 0;
            let cssCount = 0;

            resources.forEach((r: any) => {
                totalSize += r.transferSize || 0;
                if (r.name.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) imageCount++;
                if (r.name.match(/\.js/i)) jsCount++;
                if (r.name.match(/\.css/i)) cssCount++;
            });

            return {
                totalSize: Math.round(totalSize / 1024), // KB
                imageCount,
                jsCount,
                cssCount,
                resourceCount: resources.length
            };
        });

        if (metrics.totalSize > 3000) {
            result.categories.performance.issues.push({
                severity: 'warning',
                title: 'Большой размер страницы',
                description: `Размер: ${metrics.totalSize} KB (рекомендуется < 3 MB)`,
                fix: 'Сжатие изображений, ленивая загрузка, минификация'
            });
            result.categories.performance.score -= 10;
        }

        // === SEO ===
        const seoData = await page.evaluate(() => {
            const title = document.querySelector('title')?.textContent?.trim() || '';
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const h1 = document.querySelector('h1')?.textContent?.trim() || '';
            const h2Count = document.querySelectorAll('h2').length;
            const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
            const robots = document.querySelector('meta[name="robots"]')?.getAttribute('content') || '';
            const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
            const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';

            const images = document.querySelectorAll('img');
            let imagesWithoutAlt = 0;
            images.forEach(img => {
                if (!img.getAttribute('alt')) imagesWithoutAlt++;
            });

            const links = document.querySelectorAll('a[href]');
            let brokenLinks = 0;
            links.forEach(a => {
                const href = a.getAttribute('href') || '';
                if (href === '#' || href === '' || href === 'javascript:void(0)') brokenLinks++;
            });

            return { title, metaDesc, h1, h2Count, canonical, robots, ogTitle, ogImage, imagesWithoutAlt, brokenLinks, imageCount: images.length };
        });

        if (!seoData.title || seoData.title.length < 10) {
            result.categories.seo.issues.push({
                severity: 'critical',
                title: 'Отсутствует или слишком короткий title',
                description: 'Title важен для SEO и отображается в поиске',
                fix: 'Добавить уникальный title 50-60 символов'
            });
            result.categories.seo.score -= 25;
        } else if (seoData.title.length > 60) {
            result.categories.seo.issues.push({
                severity: 'info',
                title: 'Title слишком длинный',
                description: `Длина: ${seoData.title.length} символов (рекомендуется 50-60)`,
                fix: 'Сократить title до 60 символов'
            });
            result.categories.seo.score -= 5;
        }

        if (!seoData.metaDesc) {
            result.categories.seo.issues.push({
                severity: 'warning',
                title: 'Отсутствует meta description',
                description: 'Description показывается в результатах поиска',
                fix: 'Добавить description 150-160 символов'
            });
            result.categories.seo.score -= 15;
        }

        if (!seoData.h1) {
            result.categories.seo.issues.push({
                severity: 'warning',
                title: 'Отсутствует заголовок H1',
                description: 'H1 важен для понимания темы страницы',
                fix: 'Добавить один H1 с ключевыми словами'
            });
            result.categories.seo.score -= 15;
        }

        if (!seoData.ogTitle || !seoData.ogImage) {
            result.categories.seo.issues.push({
                severity: 'info',
                title: 'Нет Open Graph разметки',
                description: 'OG теги нужны для красивого отображения в соцсетях',
                fix: 'Добавить og:title, og:description, og:image'
            });
            result.categories.seo.score -= 5;
        }

        if (seoData.imagesWithoutAlt > 0) {
            result.categories.seo.issues.push({
                severity: 'info',
                title: `${seoData.imagesWithoutAlt} изображений без alt`,
                description: 'Alt-текст улучшает SEO и доступность',
                fix: 'Добавить описательные alt-тексты'
            });
            result.categories.seo.score -= 5;
        }

        // === MOBILE ===
        const mobileData = await page.evaluate(() => {
            const viewport = document.querySelector('meta[name="viewport"]');
            const hasViewport = !!viewport;
            const viewportContent = viewport?.getAttribute('content') || '';

            // Check for touch-friendly elements
            const buttons = document.querySelectorAll('button, .btn, [class*="button"]');
            let smallButtons = 0;
            buttons.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                if (rect.width < 44 || rect.height < 44) smallButtons++;
            });

            // Check font sizes
            const body = document.body;
            const computedStyle = window.getComputedStyle(body);
            const fontSize = parseInt(computedStyle.fontSize);

            return { hasViewport, viewportContent, smallButtons, fontSize };
        });

        if (!mobileData.hasViewport) {
            result.categories.mobile.issues.push({
                severity: 'critical',
                title: 'Отсутствует viewport meta-тег',
                description: 'Сайт не будет корректно отображаться на мобильных',
                fix: 'Добавить <meta name="viewport" content="width=device-width, initial-scale=1">'
            });
            result.categories.mobile.score -= 40;
        }

        if (mobileData.fontSize < 14) {
            result.categories.mobile.issues.push({
                severity: 'warning',
                title: 'Слишком мелкий шрифт',
                description: `Базовый размер: ${mobileData.fontSize}px (рекомендуется минимум 16px)`,
                fix: 'Увеличить базовый размер шрифта'
            });
            result.categories.mobile.score -= 15;
        }

        // === SECURITY ===
        if (url.startsWith('http://')) {
            result.categories.security.issues.push({
                severity: 'critical',
                title: 'Сайт работает без HTTPS',
                description: 'Браузеры помечают как "Небезопасный"',
                fix: 'Установить SSL-сертификат (Let\'s Encrypt — бесплатно)'
            });
            result.categories.security.score -= 40;
        }

        // Check for mixed content
        const hasMixedContent = await page.evaluate(() => {
            const resources = document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"]');
            return resources.length > 0;
        });

        if (hasMixedContent && url.startsWith('https://')) {
            result.categories.security.issues.push({
                severity: 'warning',
                title: 'Смешанный контент (Mixed Content)',
                description: 'Некоторые ресурсы загружаются по HTTP',
                fix: 'Перевести все ресурсы на HTTPS'
            });
            result.categories.security.score -= 15;
        }

        // === UX ===
        const uxData = await page.evaluate(() => {
            // Contact options
            const hasPhone = !!document.body.innerHTML.match(/\+?\d[\d\s()-]{8,}/);
            const hasEmail = !!document.body.innerHTML.match(/[\w.-]+@[\w.-]+\.\w+/);
            const hasWhatsApp = document.body.innerHTML.toLowerCase().includes('whatsapp') ||
                document.body.innerHTML.includes('wa.me');
            const hasTelegram = document.body.innerHTML.toLowerCase().includes('telegram') ||
                document.body.innerHTML.includes('t.me');

            // Forms and CTAs
            const forms = document.querySelectorAll('form');
            const ctaButtons = document.querySelectorAll('.btn, [class*="button"], button[type="submit"]');

            return { hasPhone, hasEmail, hasWhatsApp, hasTelegram, formCount: forms.length, ctaCount: ctaButtons.length };
        });

        if (!uxData.hasPhone && !uxData.hasEmail) {
            result.categories.ux.issues.push({
                severity: 'critical',
                title: 'Нет контактной информации',
                description: 'Посетители не могут связаться с вами',
                fix: 'Добавить телефон и email на видное место'
            });
            result.categories.ux.score -= 30;
        }

        if (!uxData.hasWhatsApp && !uxData.hasTelegram) {
            result.categories.ux.issues.push({
                severity: 'info',
                title: 'Нет мессенджеров',
                description: 'WhatsApp/Telegram увеличивают конверсию на 20-30%',
                fix: 'Добавить кнопки мессенджеров'
            });
            result.categories.ux.score -= 10;
        }

        if (uxData.formCount === 0) {
            result.categories.ux.issues.push({
                severity: 'warning',
                title: 'Нет формы обратной связи',
                description: 'Форма — основной способ сбора лидов',
                fix: 'Добавить форму с минимальным количеством полей'
            });
            result.categories.ux.score -= 15;
        }

        // Tech stack detection
        const techStack = await page.evaluate(() => {
            const tech: string[] = [];
            const html = document.documentElement.outerHTML;

            if (html.includes('wp-content') || html.includes('wordpress')) tech.push('WordPress');
            if (html.includes('bitrix')) tech.push('1C-Битрикс');
            if (html.includes('tilda')) tech.push('Tilda');
            if (html.includes('wix')) tech.push('Wix');
            if (html.includes('shopify')) tech.push('Shopify');
            if (html.includes('react') || html.includes('__NEXT')) tech.push('React');
            if (html.includes('vue')) tech.push('Vue.js');
            if (html.includes('bootstrap')) tech.push('Bootstrap');
            if (html.includes('jquery')) tech.push('jQuery');
            if (html.includes('gtm') || html.includes('googletagmanager')) tech.push('Google Tag Manager');
            if (html.includes('yandex.metrika') || html.includes('mc.yandex')) tech.push('Яндекс.Метрика');
            if (html.includes('google-analytics') || html.includes('gtag')) tech.push('Google Analytics');

            return tech;
        });
        result.techStack = techStack;

    } catch (error) {
        result.categories.performance.issues.push({
            severity: 'critical',
            title: 'Сайт недоступен',
            description: 'Не удалось загрузить страницу',
            fix: 'Проверить работу хостинга и DNS'
        });
        result.categories.performance.score = 0;
    }

    // Calculate overall score
    const catScores = Object.values(result.categories).map(c => Math.max(0, c.score));
    result.score = Math.round(catScores.reduce((a, b) => a + b, 0) / catScores.length);

    // Generate recommendations
    const allIssues = Object.values(result.categories).flatMap(c => c.issues);
    const criticalIssues = allIssues.filter(i => i.severity === 'critical');
    const warningIssues = allIssues.filter(i => i.severity === 'warning');

    if (criticalIssues.length > 0) {
        result.recommendations.push('Исправить критические проблемы в первую очередь');
    }
    criticalIssues.forEach(i => result.recommendations.push(i.fix));
    warningIssues.slice(0, 3).forEach(i => result.recommendations.push(i.fix));

    return result;
}

function generatePDFReport(audit: AuditResult, outputPath: string): void {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(24).fillColor('#1a1a1a').text('АУДИТ САЙТА', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(16).fillColor('#666').text(audit.url, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(12).text(`Подготовлено для: ${audit.company}`, { align: 'center' });
    doc.fontSize(10).text(`Дата: ${audit.timestamp.toLocaleDateString('ru-RU')}`, { align: 'center' });

    doc.moveDown(2);

    // Overall Score
    doc.fontSize(18).fillColor('#1a1a1a').text('Общая оценка');
    doc.moveDown(0.5);

    const scoreColor = audit.score >= 80 ? '#22c55e' : audit.score >= 60 ? '#f59e0b' : '#ef4444';
    doc.fontSize(48).fillColor(scoreColor).text(`${audit.score}/100`, { align: 'left' });

    doc.moveDown(1);

    // Load time
    doc.fontSize(12).fillColor('#666').text(`Время загрузки: ${(audit.loadTime / 1000).toFixed(2)} сек`);
    if (audit.techStack.length > 0) {
        doc.text(`Технологии: ${audit.techStack.join(', ')}`);
    }

    doc.moveDown(2);

    // Categories
    const categoryNames: Record<string, string> = {
        performance: 'Производительность',
        seo: 'SEO',
        mobile: 'Мобильная версия',
        security: 'Безопасность',
        ux: 'Удобство использования'
    };

    for (const [key, cat] of Object.entries(audit.categories)) {
        const catColor = cat.score >= 80 ? '#22c55e' : cat.score >= 60 ? '#f59e0b' : '#ef4444';

        doc.fontSize(14).fillColor('#1a1a1a').text(`${categoryNames[key]}: `, { continued: true });
        doc.fillColor(catColor).text(`${cat.score}/100`);

        if (cat.issues.length > 0) {
            doc.moveDown(0.3);
            cat.issues.forEach(issue => {
                const severityIcon = issue.severity === 'critical' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
                doc.fontSize(11).fillColor('#333').text(`  ${severityIcon} ${issue.title}`);
                doc.fontSize(10).fillColor('#666').text(`     ${issue.description}`);
            });
        }

        doc.moveDown(1);
    }

    // Recommendations
    if (audit.recommendations.length > 0) {
        doc.addPage();
        doc.fontSize(18).fillColor('#1a1a1a').text('Рекомендации');
        doc.moveDown(1);

        audit.recommendations.forEach((rec, i) => {
            doc.fontSize(12).fillColor('#333').text(`${i + 1}. ${rec}`);
            doc.moveDown(0.5);
        });
    }

    // Footer
    doc.moveDown(2);
    doc.fontSize(10).fillColor('#999').text('Подготовлено RahmetLabs', { align: 'center' });
    doc.text('rahmetlabs.com', { align: 'center' });

    doc.end();
}

function generateOutreachMessage(audit: AuditResult): string {
    const criticalCount = Object.values(audit.categories)
        .flatMap(c => c.issues)
        .filter(i => i.severity === 'critical').length;

    const topIssues = Object.values(audit.categories)
        .flatMap(c => c.issues)
        .filter(i => i.severity === 'critical' || i.severity === 'warning')
        .slice(0, 3);

    let issuesList = topIssues.map((i, n) => `${n + 1}. ${i.title}`).join('\n');

    if (audit.score >= 80) {
        return `Добрый день.

Провёл аудит вашего сайта ${audit.url}

Результат: ${audit.score}/100 — хороший показатель.

Есть несколько рекомендаций по улучшению:
${issuesList || 'Мелкие оптимизации'}

Готов выслать полный PDF-отчёт с подробным анализом.

Интересно?`;
    }

    return `Добрый день.

Провёл аудит вашего сайта ${audit.url}

Результат: ${audit.score}/100

Обнаружено ${criticalCount} критических проблем:
${issuesList}

Подготовил подробный PDF-отчёт с рекомендациями по исправлению.

Выслать?`;
}

// Main function
async function auditLeads(limit: number = 3): Promise<void> {
    await leads.connect();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const allLeads = await leads.getByState('discovered');
    const leadsWithSites = allLeads.filter(l =>
        l.website &&
        !l.website.includes('homes.com') &&
        !l.website.includes('greatschools')
    );

    console.log('\n=== COMPREHENSIVE WEBSITE AUDIT ===\n');
    console.log(`Auditing ${Math.min(limit, leadsWithSites.length)} of ${leadsWithSites.length} leads\n`);

    const reportsDir = './reports';
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir);
    }

    for (const lead of leadsWithSites.slice(0, limit)) {
        console.log(`\nAuditing: ${lead.companyName}`);
        console.log(`URL: ${lead.website}`);

        const audit = await runFullAudit(page, lead.website!, lead.companyName || 'Unknown');

        console.log(`Score: ${audit.score}/100`);
        console.log(`Issues: ${Object.values(audit.categories).flatMap(c => c.issues).length}`);

        // Generate PDF
        const pdfPath = path.join(reportsDir, `audit_${lead.id.substring(0, 8)}.pdf`);
        generatePDFReport(audit, pdfPath);
        console.log(`PDF: ${pdfPath}`);

        // Generate message
        const message = generateOutreachMessage(audit);
        console.log('\n--- OUTREACH MESSAGE ---');
        console.log(message);
        console.log('------------------------');

        await page.waitForTimeout(2000);
    }

    await browser.close();
    await leads.disconnect();

    console.log('\n✅ Audit complete. PDFs saved to ./reports/');
}

export const comprehensiveAudit = {
    runFullAudit,
    generatePDFReport,
    generateOutreachMessage,
    auditLeads
};

auditLeads(3).catch(console.error);
