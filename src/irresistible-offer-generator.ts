/**
 * Irresistible Offer Generator
 * 
 * 1. Analyzes lead's current site
 * 2. Generates mockup of better version
 * 3. Creates packaged offer with pricing
 * 4. Sends via WhatsApp with mockup
 */
import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { leads } from './leads.js';
import type { Lead } from './types.js';

// === PACKAGE DEFINITIONS ===
interface Package {
    name: string;
    nameRu: string;
    price: number;
    priceDisplay: string;
    includes: string[];
    timeline: string;
}

const PACKAGES: Record<string, Package> = {
    start: {
        name: 'start',
        nameRu: 'СТАРТ',
        price: 1500000, // ~$3,200
        priceDisplay: '$3,000',
        includes: [
            'Лендинг на 1-3 страницы',
            'Современный адаптивный дизайн',
            'WhatsApp кнопка + форма заявки',
            'Базовое SEO',
            'Хостинг на 1 год'
        ],
        timeline: '1-2 недели'
    },
    standard: {
        name: 'standard',
        nameRu: 'СТАНДАРТ',
        price: 5500000, // ~$12,000
        priceDisplay: '$10,000 - $12,000',
        includes: [
            'Сайт до 10 страниц',
            'Премиум дизайн под ваш бренд',
            'WhatsApp/Telegram бот с AI',
            'Формы с уведомлениями',
            'Google Analytics + Яндекс.Метрика',
            'SEO оптимизация',
            'Техподдержка 3 месяца'
        ],
        timeline: '3-4 недели'
    },
    premium: {
        name: 'premium',
        nameRu: 'ПРЕМИУМ',
        price: 14000000, // ~$30,000
        priceDisplay: '$25,000 - $35,000',
        includes: [
            'Полноценная платформа',
            'AI чат-бот с обучением на ваших данных',
            'Интеграция с 1С / CRM',
            'Личный кабинет для клиентов',
            'Мобильная версия (PWA)',
            'Аналитика и дашборды',
            'Техподдержка 12 месяцев'
        ],
        timeline: '6-8 недель'
    }
};

// === INDUSTRY TEMPLATES ===
interface IndustryTemplate {
    industry: string;
    industryRu: string;
    heroTitle: string;
    heroSubtitle: string;
    features: string[];
    cta: string;
    colorScheme: {
        primary: string;
        secondary: string;
        accent: string;
    };
}

const INDUSTRY_TEMPLATES: Record<string, IndustryTemplate> = {
    education: {
        industry: 'education',
        industryRu: 'Образование',
        heroTitle: 'Ваше будущее начинается здесь',
        heroSubtitle: 'Качественное образование для успешной карьеры',
        features: ['Онлайн-заявка', 'Виртуальный тур', 'Чат с приёмной комиссией', 'Расписание'],
        cta: 'Подать заявку',
        colorScheme: {
            primary: '#1e40af',
            secondary: '#3b82f6',
            accent: '#f59e0b'
        }
    },
    logistics: {
        industry: 'logistics',
        industryRu: 'Логистика',
        heroTitle: 'Доставка по всему Казахстану',
        heroSubtitle: 'Быстро. Надёжно. В срок.',
        features: ['Расчёт стоимости', 'Отслеживание груза', 'Заказ курьера', 'Калькулятор'],
        cta: 'Рассчитать доставку',
        colorScheme: {
            primary: '#059669',
            secondary: '#10b981',
            accent: '#f97316'
        }
    },
    realestate: {
        industry: 'realestate',
        industryRu: 'Недвижимость',
        heroTitle: 'Найдите дом вашей мечты',
        heroSubtitle: 'Лучшие объекты в Алматы и Астане',
        features: ['Каталог объектов', '3D-туры', 'Ипотечный калькулятор', 'Онлайн-бронирование'],
        cta: 'Смотреть объекты',
        colorScheme: {
            primary: '#7c3aed',
            secondary: '#8b5cf6',
            accent: '#ec4899'
        }
    },
    clinic: {
        industry: 'clinic',
        industryRu: 'Медицина',
        heroTitle: 'Забота о вашем здоровье',
        heroSubtitle: 'Современная клиника с опытными специалистами',
        features: ['Онлайн-запись', 'Телемедицина', 'Результаты анализов', 'Напоминания'],
        cta: 'Записаться на приём',
        colorScheme: {
            primary: '#0891b2',
            secondary: '#06b6d4',
            accent: '#14b8a6'
        }
    },
    default: {
        industry: 'default',
        industryRu: 'Бизнес',
        heroTitle: 'Добро пожаловать',
        heroSubtitle: 'Профессиональные решения для вашего бизнеса',
        features: ['О компании', 'Услуги', 'Контакты', 'Заявка'],
        cta: 'Связаться с нами',
        colorScheme: {
            primary: '#1f2937',
            secondary: '#374151',
            accent: '#3b82f6'
        }
    }
};

// === SITE ANALYZER ===
interface SiteAnalysis {
    url: string;
    hasWhatsApp: boolean;
    hasTelegram: boolean;
    hasForm: boolean;
    hasChat: boolean;
    isMobile: boolean;
    isHttps: boolean;
    loadTime: number;
    industry: string;
    brandColors: string[];
    currentScreenshot?: string;
    issues: string[];
    score: number;
}

async function analyzeSite(page: Page, url: string): Promise<SiteAnalysis> {
    const analysis: SiteAnalysis = {
        url,
        hasWhatsApp: false,
        hasTelegram: false,
        hasForm: false,
        hasChat: false,
        isMobile: false,
        isHttps: url.startsWith('https'),
        loadTime: 0,
        industry: 'default',
        brandColors: [],
        issues: [],
        score: 100
    };

    try {
        if (!url.startsWith('http')) url = 'https://' + url;

        const start = Date.now();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        analysis.loadTime = Date.now() - start;

        // Take screenshot of current site
        const screenshotPath = `./reports/screenshots/${Date.now()}_current.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        analysis.currentScreenshot = screenshotPath;

        // Analyze features
        const features = await page.evaluate(() => {
            const html = document.body.innerHTML.toLowerCase();
            const hasWhatsApp = html.includes('whatsapp') || html.includes('wa.me');
            const hasTelegram = html.includes('telegram') || html.includes('t.me');
            const hasForm = document.querySelectorAll('form').length > 0;
            const hasChat = html.includes('jivo') || html.includes('tawk') ||
                html.includes('carrot') || html.includes('intercom') ||
                html.includes('chat');
            const viewport = !!document.querySelector('meta[name="viewport"]');

            // Try to detect industry
            let industry = 'default';
            if (html.includes('универс') || html.includes('колледж') || html.includes('школ') ||
                html.includes('образован') || html.includes('студент') || html.includes('абитур')) {
                industry = 'education';
            } else if (html.includes('достав') || html.includes('логист') || html.includes('груз') ||
                html.includes('транспорт') || html.includes('карго')) {
                industry = 'logistics';
            } else if (html.includes('недвижим') || html.includes('квартир') || html.includes('дом') ||
                html.includes('аренд')) {
                industry = 'realestate';
            } else if (html.includes('клиник') || html.includes('врач') || html.includes('медиц') ||
                html.includes('здоров')) {
                industry = 'clinic';
            }

            // Extract colors (simplified)
            const colors: string[] = [];
            const links = document.querySelectorAll('a');
            if (links.length > 0) {
                const linkColor = window.getComputedStyle(links[0]).color;
                if (linkColor) colors.push(linkColor);
            }

            return { hasWhatsApp, hasTelegram, hasForm, hasChat, viewport, industry, colors };
        });

        analysis.hasWhatsApp = features.hasWhatsApp;
        analysis.hasTelegram = features.hasTelegram;
        analysis.hasForm = features.hasForm;
        analysis.hasChat = features.hasChat;
        analysis.isMobile = features.viewport;
        analysis.industry = features.industry;
        analysis.brandColors = features.colors;

        // Calculate issues and score
        if (!analysis.hasWhatsApp && !analysis.hasTelegram) {
            analysis.issues.push('Нет мессенджеров');
            analysis.score -= 15;
        }
        if (!analysis.hasForm) {
            analysis.issues.push('Нет формы заявки');
            analysis.score -= 15;
        }
        if (!analysis.isMobile) {
            analysis.issues.push('Не адаптирован под мобильные');
            analysis.score -= 20;
        }
        if (!analysis.isHttps) {
            analysis.issues.push('Нет HTTPS');
            analysis.score -= 15;
        }
        if (analysis.loadTime > 3000) {
            analysis.issues.push('Медленная загрузка');
            analysis.score -= 10;
        }
        if (!analysis.hasChat) {
            analysis.issues.push('Нет онлайн-чата');
            analysis.score -= 10;
        }

    } catch (e) {
        analysis.issues.push('Сайт недоступен');
        analysis.score = 20;
    }

    return analysis;
}

// === MOCKUP HTML GENERATOR ===
function generateMockupHTML(lead: Lead, template: IndustryTemplate): string {
    const companyName = lead.companyName || 'Компания';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${companyName} — Концепт нового сайта</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; color: #1f2937; }
        
        .header {
            background: white;
            padding: 1rem 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .logo { font-weight: 700; font-size: 1.5rem; color: ${template.colorScheme.primary}; }
        .nav { display: flex; gap: 2rem; }
        .nav a { text-decoration: none; color: #4b5563; font-weight: 500; }
        .nav a:hover { color: ${template.colorScheme.primary}; }
        
        .hero {
            background: linear-gradient(135deg, ${template.colorScheme.primary} 0%, ${template.colorScheme.secondary} 100%);
            color: white;
            padding: 6rem 2rem;
            text-align: center;
        }
        .hero h1 { font-size: 3rem; font-weight: 700; margin-bottom: 1rem; }
        .hero p { font-size: 1.25rem; opacity: 0.9; margin-bottom: 2rem; }
        .hero-btn {
            background: ${template.colorScheme.accent};
            color: white;
            padding: 1rem 2.5rem;
            border: none;
            border-radius: 8px;
            font-size: 1.1rem;
            font-weight: 600;
            cursor: pointer;
            display: inline-block;
            text-decoration: none;
        }
        
        .features {
            padding: 4rem 2rem;
            background: #f9fafb;
        }
        .features h2 { text-align: center; margin-bottom: 3rem; font-size: 2rem; }
        .features-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .feature-card {
            background: white;
            padding: 2rem;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
        }
        .feature-icon {
            width: 60px;
            height: 60px;
            background: ${template.colorScheme.primary}20;
            border-radius: 12px;
            margin: 0 auto 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }
        .feature-card h3 { margin-bottom: 0.5rem; color: ${template.colorScheme.primary}; }
        
        .cta-section {
            background: ${template.colorScheme.primary};
            color: white;
            padding: 4rem 2rem;
            text-align: center;
        }
        .cta-section h2 { margin-bottom: 1rem; font-size: 2rem; }
        .cta-section p { margin-bottom: 2rem; opacity: 0.9; }
        
        .whatsapp-btn {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            width: 60px;
            height: 60px;
            background: #25D366;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(37, 211, 102, 0.4);
            cursor: pointer;
        }
        .whatsapp-btn svg { width: 32px; height: 32px; fill: white; }
        
        .footer {
            background: #1f2937;
            color: white;
            padding: 2rem;
            text-align: center;
        }
        
        .badge {
            position: fixed;
            top: 1rem;
            left: 1rem;
            background: ${template.colorScheme.accent};
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="badge">КОНЦЕПТ — RahmetLabs</div>
    
    <header class="header">
        <div class="logo">${companyName}</div>
        <nav class="nav">
            <a href="#">Главная</a>
            <a href="#">О нас</a>
            <a href="#">Услуги</a>
            <a href="#">Контакты</a>
        </nav>
    </header>
    
    <section class="hero">
        <h1>${template.heroTitle}</h1>
        <p>${template.heroSubtitle}</p>
        <a href="#" class="hero-btn">${template.cta}</a>
    </section>
    
    <section class="features">
        <h2>Что мы предлагаем</h2>
        <div class="features-grid">
            ${template.features.map(f => `
                <div class="feature-card">
                    <div class="feature-icon">✓</div>
                    <h3>${f}</h3>
                    <p>Удобный функционал для ваших клиентов</p>
                </div>
            `).join('')}
        </div>
    </section>
    
    <section class="cta-section">
        <h2>Готовы начать?</h2>
        <p>Свяжитесь с нами сегодня и получите бесплатную консультацию</p>
        <a href="#" class="hero-btn" style="background: white; color: ${template.colorScheme.primary};">
            Связаться
        </a>
    </section>
    
    <div class="whatsapp-btn">
        <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </div>
    
    <footer class="footer">
        <p>© 2026 ${companyName}. Все права защищены.</p>
        <p style="margin-top: 0.5rem; opacity: 0.7; font-size: 0.875rem;">
            Концепт разработан RahmetLabs
        </p>
    </footer>
</body>
</html>`;
}

// === OFFER GENERATOR ===
interface Offer {
    lead: Lead;
    analysis: SiteAnalysis;
    template: IndustryTemplate;
    recommendedPackage: Package;
    mockupPath: string;
    screenshotPath: string;
    message: string;
}

async function generateOffer(page: Page, lead: Lead): Promise<Offer | null> {
    if (!lead.website) return null;

    console.log(`   Analyzing: ${lead.website}`);
    const analysis = await analyzeSite(page, lead.website);

    // Get industry template
    const template = INDUSTRY_TEMPLATES[analysis.industry] || INDUSTRY_TEMPLATES.default;

    // Recommend package based on analysis
    let recommendedPackage = PACKAGES.standard;
    if (analysis.score >= 70) {
        recommendedPackage = PACKAGES.start; // Site is okay, just needs improvements
    } else if (analysis.score < 50) {
        recommendedPackage = PACKAGES.premium; // Site needs major work
    }

    // Generate mockup HTML
    const mockupDir = './reports/mockups';
    if (!fs.existsSync(mockupDir)) fs.mkdirSync(mockupDir, { recursive: true });

    const safeName = (lead.companyName || 'company').replace(/[^a-zA-Zа-яА-Я0-9]/g, '_').substring(0, 20);
    const mockupPath = path.join(mockupDir, `${safeName}.html`);
    const mockupHTML = generateMockupHTML(lead, template);
    fs.writeFileSync(mockupPath, mockupHTML);

    // Take screenshot of mockup
    const screenshotPath = path.join(mockupDir, `${safeName}.png`);
    try {
        await page.goto(`file://${path.resolve(mockupPath)}`, { waitUntil: 'load', timeout: 10000 });
        await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (e) {
        console.log(`   Warning: Could not generate screenshot`);
    }

    // Generate outreach message
    const message = `Добрый день.

Изучил ваш сайт ${lead.website}

Сделал концепт нового сайта для ${lead.companyName || 'вас'}:
[СКРИНШОТ ПРИКРЕПЛЁН]

Что включено в пакет "${recommendedPackage.nameRu}":
${recommendedPackage.includes.slice(0, 4).map(i => `• ${i}`).join('\n')}

Стоимость: ${recommendedPackage.priceDisplay}
Сроки: ${recommendedPackage.timeline}

Интересно обсудить?`;

    return {
        lead,
        analysis,
        template,
        recommendedPackage,
        mockupPath,
        screenshotPath,
        message
    };
}

// === MAIN ===
async function generateOffersForLeads(limit: number = 5): Promise<void> {
    await leads.connect();

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    // Create directories
    if (!fs.existsSync('./reports/screenshots')) fs.mkdirSync('./reports/screenshots', { recursive: true });

    const allLeads = await leads.getByState('discovered');
    const leadsWithSites = allLeads.filter(l =>
        l.website &&
        (l.phone?.startsWith('+7') || l.phone?.startsWith('7')) &&
        !l.website.includes('homes.com')
    );

    console.log('\n=== IRRESISTIBLE OFFER GENERATOR ===\n');
    console.log(`Processing ${Math.min(limit, leadsWithSites.length)} KZ leads\n`);

    const offers: Offer[] = [];

    for (let i = 0; i < Math.min(limit, leadsWithSites.length); i++) {
        const lead = leadsWithSites[i];
        console.log(`[${i + 1}/${Math.min(limit, leadsWithSites.length)}] ${lead.companyName}`);

        const offer = await generateOffer(page, lead);
        if (offer) {
            offers.push(offer);
            console.log(`   Industry: ${offer.template.industryRu}`);
            console.log(`   Score: ${offer.analysis.score}/100`);
            console.log(`   Package: ${offer.recommendedPackage.nameRu} (${offer.recommendedPackage.priceDisplay})`);
            console.log(`   Mockup: ${offer.screenshotPath}`);
        }

        await page.waitForTimeout(1500);
    }

    await browser.close();

    // Save summary
    const summaryPath = './reports/mockups/_offers.json';
    fs.writeFileSync(summaryPath, JSON.stringify(offers.map(o => ({
        company: o.lead.companyName,
        phone: o.lead.phone,
        website: o.lead.website,
        industry: o.template.industryRu,
        score: o.analysis.score,
        issues: o.analysis.issues,
        package: o.recommendedPackage.nameRu,
        price: o.recommendedPackage.priceDisplay,
        mockup: o.screenshotPath,
        message: o.message
    })), null, 2));

    console.log('\n=== RESULTS ===\n');
    console.log(`Generated: ${offers.length} offers`);
    console.log(`Mockups: ./reports/mockups/`);
    console.log(`Summary: ${summaryPath}`);

    // Show sample messages
    console.log('\n=== SAMPLE MESSAGES ===\n');
    offers.slice(0, 2).forEach(o => {
        console.log(`--- ${o.lead.companyName} (${o.lead.phone}) ---`);
        console.log(o.message);
        console.log('');
    });

    await leads.disconnect();
}

export const irresistibleOfferGenerator = {
    analyzeSite,
    generateMockupHTML,
    generateOffer,
    generateOffersForLeads,
    PACKAGES,
    INDUSTRY_TEMPLATES
};

generateOffersForLeads(5).catch(console.error);
