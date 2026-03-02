/**
 * Mass Kompra.kz Scraper
 * Scrapes ALL OKED codes × ALL regions from Kazakhstan's business registry.
 * Extracts: company name, BIN, director, activity, employee count, address.
 *
 * Usage:
 *   npx tsx src/mass-kompra-scraper.ts                  # full run
 *   npx tsx src/mass-kompra-scraper.ts --resume          # resume from checkpoint
 */

import 'dotenv/config';
import { chromium, type Browser, type Page } from 'playwright';
import { leads } from './leads.js';
import { validateLead, type RawLead } from './validation-gate.js';
import { createClient as createRedisClient } from 'redis';

// ═══════════════════════════════════════════════════════════════
// OKED CODES — Comprehensive Kazakhstan economic activity codes
// ═══════════════════════════════════════════════════════════════

const ALL_OKEDS = [
    // Agriculture & Food
    { code: '01', name: 'Растениеводство и животноводство' },
    { code: '02', name: 'Лесоводство' },
    { code: '03', name: 'Рыболовство и аквакультура' },
    { code: '10', name: 'Производство продуктов питания' },
    { code: '11', name: 'Производство напитков' },

    // Mining & Energy
    { code: '05', name: 'Добыча угля' },
    { code: '06', name: 'Добыча нефти и газа' },
    { code: '07', name: 'Добыча металлических руд' },
    { code: '08', name: 'Добыча прочих полезных ископаемых' },
    { code: '35', name: 'Электро-, газо- и теплоснабжение' },

    // Manufacturing
    { code: '13', name: 'Производство текстильных изделий' },
    { code: '14', name: 'Производство одежды' },
    { code: '15', name: 'Производство кожи и обуви' },
    { code: '16', name: 'Обработка древесины' },
    { code: '17', name: 'Производство бумаги' },
    { code: '18', name: 'Полиграфия' },
    { code: '20', name: 'Производство химических веществ' },
    { code: '21', name: 'Производство лекарственных средств' },
    { code: '22', name: 'Производство резиновых и пластмассовых изделий' },
    { code: '23', name: 'Производство неметаллической минеральной продукции' },
    { code: '24', name: 'Производство металлов' },
    { code: '25', name: 'Производство готовых металлических изделий' },
    { code: '26', name: 'Производство электронного оборудования' },
    { code: '27', name: 'Производство электрооборудования' },
    { code: '28', name: 'Производство машин и оборудования' },
    { code: '29', name: 'Производство автотранспортных средств' },
    { code: '31', name: 'Производство мебели' },
    { code: '32', name: 'Производство прочих изделий' },

    // Construction
    { code: '41', name: 'Строительство зданий' },
    { code: '42', name: 'Строительство инженерных сооружений' },
    { code: '43', name: 'Специализированные строительные работы' },

    // Trade
    { code: '45', name: 'Торговля автотранспортными средствами' },
    { code: '46', name: 'Оптовая торговля' },
    { code: '47', name: 'Розничная торговля' },

    // Transport & Logistics
    { code: '49', name: 'Сухопутный транспорт' },
    { code: '50', name: 'Водный транспорт' },
    { code: '51', name: 'Воздушный транспорт' },
    { code: '52', name: 'Складирование и логистика' },
    { code: '53', name: 'Почтовая и курьерская деятельность' },

    // Accommodation & Food
    { code: '55', name: 'Предоставление жилья' },
    { code: '56', name: 'Общественное питание' },

    // IT & Communications
    { code: '58', name: 'Издательская деятельность' },
    { code: '59', name: 'Кино- и видеопроизводство' },
    { code: '60', name: 'Телевидение и радиовещание' },
    { code: '61', name: 'Телекоммуникации' },
    { code: '62', name: 'Разработка ПО и IT-консалтинг' },
    { code: '63', name: 'Информационные услуги' },

    // Finance & Insurance
    { code: '64', name: 'Финансовые услуги' },
    { code: '65', name: 'Страхование' },
    { code: '66', name: 'Вспомогательные финансовые услуги' },

    // Real Estate
    { code: '68', name: 'Операции с недвижимостью' },

    // Professional Services
    { code: '69', name: 'Юридические и бухгалтерские услуги' },
    { code: '70', name: 'Консультирование по управлению' },
    { code: '71', name: 'Архитектура и инженерные изыскания' },
    { code: '72', name: 'Научные исследования' },
    { code: '73', name: 'Реклама и маркетинг' },
    { code: '74', name: 'Прочая профессиональная деятельность' },
    { code: '75', name: 'Ветеринарные услуги' },

    // Admin & Support
    { code: '77', name: 'Аренда и лизинг' },
    { code: '78', name: 'Трудоустройство и подбор персонала' },
    { code: '79', name: 'Туристические агентства' },
    { code: '80', name: 'Охранная деятельность' },
    { code: '81', name: 'Обслуживание зданий и территорий' },
    { code: '82', name: 'Административные и офисные услуги' },

    // Education
    { code: '85', name: 'Образование' },

    // Healthcare
    { code: '86', name: 'Здравоохранение' },
    { code: '87', name: 'Социальное обслуживание с проживанием' },
    { code: '88', name: 'Социальное обслуживание без проживания' },

    // Arts & Recreation
    { code: '90', name: 'Искусство и развлечения' },
    { code: '91', name: 'Библиотеки и музеи' },
    { code: '92', name: 'Организация азартных игр' },
    { code: '93', name: 'Спорт и отдых' },

    // Other Services
    { code: '95', name: 'Ремонт компьютеров и бытовой техники' },
    { code: '96', name: 'Прочие персональные услуги' },
];

const CONFIG = {
    maxCompaniesPerOked: 500,    // pagination limit per OKED code
    delayBetweenPages: 2000,
    checkpointKey: 'scrape:kompra:checkpoint',
    progressKey: 'scrape:kompra:progress',
};

// ═══════════════════════════════════════════════════════════════
// CHECKPOINT
// ═══════════════════════════════════════════════════════════════

class KompraCheckpoint {
    private redis: ReturnType<typeof createRedisClient> | null = null;

    async connect() {
        this.redis = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
        await this.redis.connect();
    }

    async isCompleted(okedCode: string): Promise<boolean> {
        if (!this.redis) return false;
        return (await this.redis.get(`${CONFIG.checkpointKey}:${okedCode}`)) === 'done';
    }

    async markCompleted(okedCode: string, count: number): Promise<void> {
        if (!this.redis) return;
        await this.redis.set(`${CONFIG.checkpointKey}:${okedCode}`, 'done');
        const raw = await this.redis.get(CONFIG.progressKey);
        const p = raw ? JSON.parse(raw) : { completed: 0, total: 0, byOked: {} };
        p.completed++;
        p.total += count;
        p.byOked[okedCode] = count;
        await this.redis.set(CONFIG.progressKey, JSON.stringify(p));
    }

    async resetAll(): Promise<void> {
        if (!this.redis) return;
        const keys = await this.redis.keys(`${CONFIG.checkpointKey}:*`);
        if (keys.length > 0) await this.redis.del(keys);
        await this.redis.del(CONFIG.progressKey);
    }

    async disconnect() { if (this.redis) await this.redis.disconnect(); }
}

// ═══════════════════════════════════════════════════════════════
// SCRAPER
// ═══════════════════════════════════════════════════════════════

async function scrapeOked(page: Page, okedCode: string, okedName: string): Promise<RawLead[]> {
    const allLeads: RawLead[] = [];
    const seenBINs = new Set<string>();
    let pageNum = 1;

    while (allLeads.length < CONFIG.maxCompaniesPerOked) {
        const url = `https://kompra.kz/ru/search?oked=${okedCode}&status=active&page=${pageNum}`;

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(1500);

            // Extract companies from current page
            const companies = await page.evaluate(({ okedCode, okedName }) => {
                const items = document.querySelectorAll('.search__item, .company-item, [class*="search-result"]');
                const results: any[] = [];

                items.forEach(item => {
                    try {
                        const nameEl = item.querySelector('.sr-item__title, h3, h4, [class*="title"]');
                        const name = nameEl?.textContent?.trim() || '';

                        // Extract fields from layout containers
                        const layouts = item.querySelectorAll('.sr-item__layout, [class*="field"], [class*="info"]');
                        let bin = '', director = '', address = '', activity = '', employees = '', phone = '', email = '';

                        layouts.forEach(layout => {
                            const label = layout.querySelector('.sr-item__label, [class*="label"]')?.textContent?.trim() || '';
                            const value = layout.querySelector('.sr-item__value, [class*="value"]')?.textContent?.trim() || '';
                            if (label.includes('БИН') || label.includes('ИИН')) bin = value;
                            if (label.includes('Руководитель') || label.includes('Директор')) director = value;
                            if (label.includes('адрес')) address = value;
                            if (label.includes('Деятельность') || label.includes('ОКЭД')) activity = value;
                            if (label.includes('Сотрудн')) employees = value;
                            if (label.includes('Телефон') || label.includes('тел')) phone = value;
                            if (label.includes('почта') || label.includes('email')) email = value;
                        });

                        // Fallback: regex BIN from full text
                        if (!bin) {
                            const text = item.textContent || '';
                            const binMatch = text.match(/\b\d{12}\b/);
                            if (binMatch) bin = binMatch[0];
                        }

                        // Phone from full text
                        if (!phone) {
                            const text = item.textContent || '';
                            const phoneMatch = text.match(/[\+]?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/);
                            if (phoneMatch) phone = phoneMatch[0];
                        }

                        if (name) {
                            results.push({ name, bin, director, address, activity, employees, phone, email });
                        }
                    } catch { }
                });

                return results;
            }, { okedCode, okedName });

            if (companies.length === 0) break; // no more results

            for (const c of companies) {
                if (c.bin && seenBINs.has(c.bin)) continue;
                if (c.bin) seenBINs.add(c.bin);

                const directorParts = (c.director || '').split(' ');
                const lastName = directorParts[0] || '';
                const firstName = directorParts.slice(1).join(' ') || '';

                allLeads.push({
                    companyName: c.name,
                    bin: c.bin,
                    director: c.director,
                    phone: c.phone || undefined,
                    email: c.email || undefined,
                    address: c.address,
                    category: okedName,
                    source: 'kompra',
                    sourceUrl: `https://kompra.kz/ru/search?oked=${okedCode}`,
                    tags: [`oked_${okedCode}`, okedName, 'kompra'],
                    notes: [
                        c.bin ? `BIN: ${c.bin}` : '',
                        c.director ? `Director: ${c.director}` : '',
                        c.employees ? `Employees: ${c.employees}` : '',
                        c.activity ? `Activity: ${c.activity}` : '',
                    ].filter(Boolean),
                });
            }

            console.log(`    Page ${pageNum}: ${companies.length} companies (total: ${allLeads.length})`);
            pageNum++;
            await page.waitForTimeout(CONFIG.delayBetweenPages);

        } catch (err: any) {
            console.log(`    ⚠️ Page ${pageNum} error: ${err.message?.substring(0, 60)}`);
            break;
        }
    }

    return allLeads;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const resumeMode = args.includes('--resume');
    const resetMode = args.includes('--reset');

    console.log('═══════════════════════════════════════════════════════');
    console.log('🏛️  MASS KOMPRA.KZ SCRAPER — KZ Business Registry');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`OKED codes: ${ALL_OKEDS.length}`);
    console.log(`Resume: ${resumeMode}\n`);

    const checkpoint = new KompraCheckpoint();
    await checkpoint.connect();
    await leads.connect();

    if (resetMode) {
        await checkpoint.resetAll();
        console.log('🔄 Checkpoints cleared\n');
    }

    const browser = await chromium.launch({
        headless: true, // Kompra doesn't block headless
        args: ['--no-sandbox'],
    });

    const page = await browser.newPage();
    let totalValid = 0;
    let totalRejected = 0;
    let totalInserted = 0;

    try {
        for (let i = 0; i < ALL_OKEDS.length; i++) {
            const oked = ALL_OKEDS[i];

            if (resumeMode && await checkpoint.isCompleted(oked.code)) {
                continue;
            }

            console.log(`\n🔍 [${i + 1}/${ALL_OKEDS.length}] OKED ${oked.code}: ${oked.name}`);

            const rawLeads = await scrapeOked(page, oked.code, oked.name);

            // Validate
            const valid: RawLead[] = [];
            let rejected = 0;
            for (const lead of rawLeads) {
                if (validateLead(lead).valid) {
                    valid.push(lead);
                } else {
                    rejected++;
                }
            }

            totalValid += valid.length;
            totalRejected += rejected;

            console.log(`  ✅ ${valid.length} valid / ❌ ${rejected} rejected`);

            // Bulk insert
            if (valid.length > 0) {
                const supaLeads = valid.map(raw => ({
                    companyName: raw.companyName,
                    phone: raw.phone,
                    email: raw.email,
                    bin: raw.bin,
                    source: 'scrape' as const,
                    sourceUrl: raw.sourceUrl,
                    state: 'discovered' as const,
                    tags: raw.tags || [],
                    notes: raw.notes || [],
                }));

                const { inserted } = await leads.bulkUpsert(supaLeads as any);
                totalInserted += inserted;
                console.log(`  💾 Saved ${inserted}`);
            }

            await checkpoint.markCompleted(oked.code, valid.length);
        }
    } finally {
        await page.close();
        await browser.close();
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 FINAL REPORT');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Valid leads:   ${totalValid}`);
    console.log(`Rejected:      ${totalRejected}`);
    console.log(`Inserted:      ${totalInserted}`);

    const stats = await leads.getStats();
    console.log(`Total DB:      ${stats.total}`);

    await checkpoint.disconnect();
    await leads.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
