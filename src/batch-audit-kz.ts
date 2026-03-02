/**
 * Batch Audit KZ Leads with PDF Reports
 */
import { chromium, type Page } from 'playwright';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import { leads } from './leads.js';

interface AuditResult {
    leadId: string;
    company: string;
    phone: string;
    url: string;
    score: number;
    issues: string[];
    message: string;
    pdfPath: string;
}

async function quickAudit(page: Page, url: string): Promise<{ score: number; issues: string[]; loadTime: number }> {
    const issues: string[] = [];
    let score = 100;
    let loadTime = 0;

    try {
        if (!url.startsWith('http')) url = 'https://' + url;

        const start = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        loadTime = Date.now() - start;

        // Performance
        if (loadTime > 5000) {
            issues.push(`Критически медленная загрузка (${(loadTime / 1000).toFixed(1)}с)`);
            score -= 20;
        } else if (loadTime > 3000) {
            issues.push(`Медленная загрузка (${(loadTime / 1000).toFixed(1)}с)`);
            score -= 10;
        }

        // SEO & Mobile
        const data = await page.evaluate(() => {
            const title = document.querySelector('title')?.textContent?.trim() || '';
            const desc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const viewport = !!document.querySelector('meta[name="viewport"]');
            const h1 = document.querySelector('h1')?.textContent?.trim() || '';
            const hasForm = document.querySelectorAll('form').length > 0;
            const hasWhatsApp = document.body.innerHTML.toLowerCase().includes('whatsapp') ||
                document.body.innerHTML.includes('wa.me');
            const hasTelegram = document.body.innerHTML.toLowerCase().includes('telegram');
            const hasPhone = !!document.body.innerHTML.match(/\+?\d[\d\s()-]{8,}/);

            return { title, desc, viewport, h1, hasForm, hasWhatsApp, hasTelegram, hasPhone };
        });

        if (!data.title || data.title.length < 10) {
            issues.push('Нет или короткий title');
            score -= 15;
        }
        if (!data.desc) {
            issues.push('Нет meta description');
            score -= 10;
        }
        if (!data.viewport) {
            issues.push('Не адаптирован под мобильные');
            score -= 20;
        }
        if (!data.h1) {
            issues.push('Нет заголовка H1');
            score -= 10;
        }
        if (!url.startsWith('https')) {
            issues.push('Нет HTTPS (небезопасно)');
            score -= 15;
        }
        if (!data.hasForm) {
            issues.push('Нет формы обратной связи');
            score -= 10;
        }
        if (!data.hasWhatsApp && !data.hasTelegram) {
            issues.push('Нет мессенджеров (WhatsApp/Telegram)');
            score -= 5;
        }

    } catch (e) {
        issues.push('Сайт недоступен или не отвечает');
        score = 20;
    }

    return { score: Math.max(0, score), issues, loadTime };
}

function generateSimplePDF(
    company: string,
    url: string,
    score: number,
    issues: string[],
    outputPath: string
): void {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(fs.createWriteStream(outputPath));

    // Header
    doc.fontSize(22).fillColor('#1a1a1a').text('ЭКСПРЕСС-АУДИТ САЙТА', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#666').text(url, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(11).text(`Для: ${company}`, { align: 'center' });
    doc.fontSize(10).text(`Дата: ${new Date().toLocaleDateString('ru-RU')}`, { align: 'center' });

    doc.moveDown(2);

    // Score
    const scoreColor = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
    doc.fontSize(16).fillColor('#1a1a1a').text('Общая оценка:');
    doc.fontSize(42).fillColor(scoreColor).text(`${score}/100`);

    doc.moveDown(1.5);

    // Issues
    if (issues.length > 0) {
        doc.fontSize(16).fillColor('#1a1a1a').text('Обнаруженные проблемы:');
        doc.moveDown(0.5);

        issues.forEach((issue, i) => {
            doc.fontSize(12).fillColor('#333').text(`${i + 1}. ${issue}`);
            doc.moveDown(0.3);
        });
    } else {
        doc.fontSize(14).fillColor('#22c55e').text('Критических проблем не обнаружено.');
    }

    doc.moveDown(2);

    // Recommendations
    doc.fontSize(16).fillColor('#1a1a1a').text('Рекомендации:');
    doc.moveDown(0.5);

    const recs = [
        'Исправить критические проблемы в первую очередь',
        'Добавить SSL-сертификат (HTTPS) — бесплатно через Let\'s Encrypt',
        'Оптимизировать скорость загрузки — сжать изображения',
        'Добавить мессенджеры (WhatsApp кнопка увеличит конверсию на 20-30%)',
        'Настроить meta-теги для SEO'
    ];

    recs.slice(0, Math.max(3, issues.length)).forEach((rec, i) => {
        doc.fontSize(11).fillColor('#333').text(`• ${rec}`);
        doc.moveDown(0.2);
    });

    doc.moveDown(2);

    // CTA
    doc.fontSize(12).fillColor('#1a1a1a').text('Хотите получить подробный аудит с планом исправления?');
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#666').text('Свяжитесь с нами — первая консультация бесплатна.');

    doc.moveDown(2);

    // Footer
    doc.fontSize(10).fillColor('#999').text('RahmetLabs — автоматизация и веб-разработка', { align: 'center' });

    doc.end();
}

async function auditAllKZLeads(): Promise<void> {
    await leads.connect();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Get KZ leads with websites
    const allLeads = await leads.getByState('discovered');
    const kzLeads = allLeads.filter(l =>
        l.website &&
        (l.phone?.startsWith('+7') || l.phone?.startsWith('7')) &&
        !l.website.includes('homes.com') &&
        !l.website.includes('greatschools')
    );

    console.log('\n=== KZ LEADS BATCH AUDIT ===\n');
    console.log(`Found ${kzLeads.length} KZ leads with websites\n`);

    const reportsDir = './reports/kz';
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    const results: AuditResult[] = [];

    for (let i = 0; i < kzLeads.length; i++) {
        const lead = kzLeads[i];
        const progress = `[${i + 1}/${kzLeads.length}]`;

        console.log(`${progress} ${lead.companyName}`);

        const audit = await quickAudit(page, lead.website!);

        // Generate PDF
        const safeName = (lead.companyName || 'unknown').replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').substring(0, 30);
        const pdfPath = path.join(reportsDir, `${safeName}.pdf`);

        generateSimplePDF(
            lead.companyName || 'Unknown',
            lead.website!,
            audit.score,
            audit.issues,
            pdfPath
        );

        // Generate message
        const topIssues = audit.issues.slice(0, 3);
        const message = audit.score >= 80
            ? `Добрый день.\n\nПровёл экспресс-аудит сайта ${lead.website}\n\nРезультат: ${audit.score}/100 — хороший показатель.\n\nЕсть несколько рекомендаций:\n${topIssues.map((i, n) => `${n + 1}. ${i}`).join('\n') || 'Мелкие оптимизации'}\n\nПодготовил PDF-отчёт. Выслать?`
            : `Добрый день.\n\nПровёл экспресс-аудит сайта ${lead.website}\n\nРезультат: ${audit.score}/100\n\nОбнаружено:\n${topIssues.map((i, n) => `${n + 1}. ${i}`).join('\n')}\n\nПодготовил PDF-отчёт с рекомендациями. Выслать?`;

        results.push({
            leadId: lead.id,
            company: lead.companyName || 'Unknown',
            phone: lead.phone || '',
            url: lead.website!,
            score: audit.score,
            issues: audit.issues,
            message,
            pdfPath
        });

        console.log(`   Score: ${audit.score}/100 | Issues: ${audit.issues.length} | PDF: ${pdfPath}`);

        // Small delay between requests
        await page.waitForTimeout(1500);
    }

    await browser.close();

    // Save results summary
    const summaryPath = path.join(reportsDir, '_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));

    console.log('\n=== SUMMARY ===\n');
    console.log(`Total audited: ${results.length}`);
    console.log(`Average score: ${Math.round(results.reduce((a, b) => a + b.score, 0) / results.length)}/100`);
    console.log(`Low score (<60): ${results.filter(r => r.score < 60).length}`);
    console.log(`PDFs saved to: ${reportsDir}/`);
    console.log(`Summary saved to: ${summaryPath}`);

    // Show sample messages
    console.log('\n=== SAMPLE MESSAGES ===\n');
    results.slice(0, 3).forEach(r => {
        console.log(`--- ${r.company} (${r.phone}) ---`);
        console.log(r.message);
        console.log('');
    });

    await leads.disconnect();
}

auditAllKZLeads().catch(console.error);
