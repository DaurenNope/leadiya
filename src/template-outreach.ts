/**
 * Simple WhatsApp Outreach (No AI - Template Based)
 * For immediate use while AI integration is set up
 */
import { leads } from './leads.js';
import { whatsapp } from './channels/whatsapp.js';
import type { Lead } from './types.js';

// Response templates based on keywords
const RESPONSES: Record<string, string> = {
    // Positive interest
    'интересно': `Отлично! 👍

Мы делаем:
• Чат-боты для автоматизации обращений
• Интеграции с 1С и CRM
• Порталы для студентов/клиентов

Можем созвониться на 15 минут, чтобы понять вашу задачу?
Когда удобно — сегодня или завтра?`,

    'расскажите': `Конечно!

Недавний кейс — Q University:
Сделали чат-бота, который отвечает на вопросы абитуриентов. Теперь 70% обращений обрабатываются автоматически.

У вас есть похожие рутинные задачи, которые съедают время?`,

    'бот': `Да, чат-боты — наша специализация! 🤖

Можем сделать бота для:
• Ответов на частые вопросы
• Приёма заявок
• WhatsApp / Telegram / сайт

Хотите обсудить конкретно под ваши задачи?`,

    'сколько': `Зависит от сложности. Обычно:
• Простой бот: от 500 000 тг
• Портал/интеграция: от 1 500 000 тг
• Крупные проекты: обсуждаем

Давайте созвонимся — расскажете задачу, я дам точную оценку.`,

    'созвон': `Отлично! 📞

Давайте завтра? Удобно в первой или второй половине дня?

Или напишите ваше время — подстроюсь.`,

    'да': `Супер! 

Расскажите немного о вашей компании и какую задачу хотелось бы решить?`,

    // Negative
    'не интересно': `Понял, спасибо за ответ! 

Если что-то понадобится — обращайтесь. Удачи! 🙏`,

    'нет': `Без проблем! Если в будущем понадобится автоматизация — пишите.

Хорошего дня! 👋`,
};

// Default response if no keyword matches
const DEFAULT_RESPONSE = `Спасибо за ответ! 

Давайте созвонимся на 15 минут — лучше обсудить голосом.
Когда удобно?`;

function findBestResponse(message: string): string {
    const lower = message.toLowerCase();

    for (const [keyword, response] of Object.entries(RESPONSES)) {
        if (lower.includes(keyword)) {
            return response;
        }
    }

    return DEFAULT_RESPONSE;
}

// Generate initial message for a lead
function generateInitialMessage(lead: Lead): string {
    const isEducation = lead.signalSummary?.includes('education') ||
        lead.companyName?.toLowerCase().includes('universi') ||
        lead.companyName?.toLowerCase().includes('колледж') ||
        lead.companyName?.toLowerCase().includes('школ');

    if (isEducation) {
        return `Здравствуйте! 👋

Это RahmetLabs — делаем автоматизацию для образования.

Работали с Q University — сделали чат-бота для абитуриентов. Теперь 70% обращений обрабатываются без участия сотрудников.

Есть ли у вас похожие рутинные задачи?`;
    }

    // Default template
    return `Здравствуйте! 👋

Это RahmetLabs — делаем автоматизацию для бизнеса.

• Чат-боты (WhatsApp, Telegram, сайт)
• Интеграции с 1С и CRM
• Порталы и веб-приложения

Занимаетесь ли вы сейчас какой-то автоматизацией?`;
}

// Test conversation in console
async function testConversation() {
    await leads.connect();

    // Get a test lead
    const allLeads = await leads.getByState('discovered');
    const kzLead = allLeads.find(l => l.phone?.startsWith('+7'));

    if (!kzLead) {
        console.log('No KZ leads found');
        await leads.disconnect();
        return;
    }

    console.log('\n📱 WhatsApp Outreach Simulator\n');
    console.log('Lead:', kzLead.companyName);
    console.log('Phone:', kzLead.phone);
    console.log('\n' + '='.repeat(50) + '\n');

    // Show initial message
    const initial = generateInitialMessage(kzLead);
    console.log('📤 BOT sends:');
    console.log(initial);
    console.log('\n' + '-'.repeat(50) + '\n');

    // Test responses
    const testMessages = [
        'Да, интересно. Расскажите подробнее',
        'Сколько это стоит?',
        'Давайте созвонимся'
    ];

    for (const msg of testMessages) {
        console.log('👤 CUSTOMER:', msg);
        console.log('📤 BOT:', findBestResponse(msg));
        console.log('');
    }

    await leads.disconnect();
}

// Export for use
export const templateOutreach = {
    generateInitialMessage,
    findBestResponse,
    testConversation
};

// Run if executed directly
testConversation().catch(console.error);
