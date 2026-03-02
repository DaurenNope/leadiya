/**
 * Irresistible Offer Outreach
 * Professional, no emojis, value-first messaging
 */
import { leads } from './leads.js';

// IRRESISTIBLE OFFERS by vertical
const OFFERS = {
    education: {
        initial: `Добрый день.

Мы провели анализ 12 университетов Казахстана и выявили, что в среднем 40% обращений абитуриентов остаются без ответа в первые 24 часа.

Предлагаем бесплатный аудит вашей приёмной комиссии:
- Сколько заявок теряется
- Где узкие места в воронке
- Сравнение с конкурентами

Результат — готовый отчёт с рекомендациями. Без обязательств.

Интересно?`,

        followup: `Добрый день.

Напоминаю о предложении бесплатного аудита приёмной комиссии.

Один из университетов после нашего аудита увеличил конверсию заявок на 35% за 2 месяца.

Если интересно — готов выслать пример отчёта.`,

        interested: `Отлично.

Для проведения аудита мне нужно:
1. Доступ к статистике обращений за последний месяц
2. 15 минут на созвон с ответственным за приём

Когда удобно организовать?`
    },

    logistics: {
        initial: `Добрый день.

Мы автоматизировали документооборот для 3 логистических компаний Казахстана. Результат — сокращение времени на обработку заказов на 60%.

Предлагаем бесплатную диагностику ваших процессов:
- Какие операции можно автоматизировать
- Расчёт экономии в часах и деньгах
- Готовый план внедрения

Это займёт 30 минут онлайн. Без обязательств.

Актуально?`,

        followup: `Добрый день.

Возвращаюсь к предложению бесплатной диагностики процессов.

Один из наших клиентов экономит 120 часов в месяц на ручном вводе данных после автоматизации.

Готов показать конкретные примеры. Интересно?`
    },

    realestate: {
        initial: `Добрый день.

Мы внедрили CRM-систему для 5 агентств недвижимости. Результат — увеличение закрытых сделок на 25% за счёт автоматизации follow-up.

Предлагаем бесплатный аудит вашей воронки продаж:
- Где теряются клиенты
- Какие касания можно автоматизировать
- Сравнение с рынком

Результат — отчёт с готовыми решениями. Без обязательств.

Интересно?`
    },

    default: {
        initial: `Добрый день.

Мы помогаем компаниям автоматизировать рутинные процессы и сокращать издержки на 30-50%.

Предлагаем бесплатную диагностику:
- Какие процессы съедают время
- Расчёт потенциальной экономии
- План автоматизации на 30/60/90 дней

Результат — готовый отчёт. Без обязательств.

Актуально?`,

        followup: `Добрый день.

Возвращаюсь к предложению бесплатной диагностики процессов.

Средний результат наших клиентов — экономия 80+ часов в месяц на ручной работе.

Если интересно — готов показать конкретные примеры и расчёты.`
    }
};

// Response handlers - professional, no emojis
const RESPONSES = {
    positive: {
        match: ['да', 'интересно', 'актуально', 'конечно', 'давайте'],
        response: `Отлично.

Для проведения диагностики мне понадобится:
1. Краткое описание основных процессов
2. 20-30 минут на онлайн-встречу

Предлагаю завтра или в четверг. Какое время удобно?`
    },

    pricing: {
        match: ['сколько', 'цена', 'стоимость', 'бюджет'],
        response: `Диагностика бесплатна — это наш способ показать экспертизу.

Стоимость внедрения зависит от объёма:
- Автоматизация 1-2 процессов: от 500 000 тг
- Комплексное решение: от 2 000 000 тг
- Enterprise: обсуждаем индивидуально

После диагностики дам точную оценку под ваши задачи.`
    },

    examples: {
        match: ['пример', 'кейс', 'покажите', 'отчёт'],
        response: `Высылаю пример отчёта по одному из университетов.

[ССЫЛКА НА PDF]

В нём показаны:
- Текущие узкие места
- Потенциальная экономия
- План внедрения

После изучения — готов обсудить аналогичный анализ для вас.`
    },

    schedule: {
        match: ['созвон', 'встреч', 'время', 'завтра', 'сегодня'],
        response: `Хорошо.

Предлагаю следующие слоты:
- Завтра, 10:00 или 15:00
- Послезавтра, 11:00 или 14:00

Формат — Zoom или Google Meet, 20-30 минут.

Какой вариант подходит?`
    },

    negative: {
        match: ['нет', 'не интересно', 'не надо', 'откажусь'],
        response: `Понял, благодарю за ответ.

Если в будущем задача станет актуальной — буду рад помочь.

Хорошего дня.`
    }
};

function detectVertical(lead: any): keyof typeof OFFERS {
    const text = `${lead.companyName || ''} ${lead.signalSummary || ''}`.toLowerCase();

    if (text.includes('universi') || text.includes('колледж') || text.includes('школ') || text.includes('education')) {
        return 'education';
    }
    if (text.includes('логист') || text.includes('transport') || text.includes('грузо')) {
        return 'logistics';
    }
    if (text.includes('недвижим') || text.includes('estate') || text.includes('строител')) {
        return 'realestate';
    }
    return 'default';
}

function generateOffer(lead: any, type: 'initial' | 'followup' = 'initial'): string {
    const vertical = detectVertical(lead);
    const offer = OFFERS[vertical];
    return (offer as Record<string, string>)[type] || offer.initial;
}

function findResponse(message: string): string {
    const lower = message.toLowerCase();

    for (const [key, handler] of Object.entries(RESPONSES)) {
        if (handler.match.some(m => lower.includes(m))) {
            return handler.response;
        }
    }

    // Default professional response
    return `Благодарю за ответ.

Если есть конкретные вопросы о диагностике — готов ответить.

Либо можем назначить короткий созвон для обсуждения.`;
}

// Demo
async function demo() {
    await leads.connect();

    const allLeads = await leads.getByState('discovered');
    const samples = allLeads.slice(0, 3);

    console.log('\n=== IRRESISTIBLE OFFER SAMPLES ===\n');

    for (const lead of samples) {
        console.log(`COMPANY: ${lead.companyName}`);
        console.log(`VERTICAL: ${detectVertical(lead)}`);
        console.log('\nMESSAGE:');
        console.log(generateOffer(lead));
        console.log('\n' + '-'.repeat(60) + '\n');
    }

    console.log('=== RESPONSE HANDLING ===\n');

    const testResponses = [
        'Да, интересно',
        'Сколько стоит?',
        'Покажите пример отчёта',
        'Давайте созвонимся завтра'
    ];

    for (const msg of testResponses) {
        console.log(`CUSTOMER: ${msg}`);
        console.log(`BOT: ${findResponse(msg)}`);
        console.log('');
    }

    await leads.disconnect();
}

export const irresistibleOffer = {
    generateOffer,
    findResponse,
    detectVertical,
    OFFERS,
    RESPONSES
};

demo().catch(console.error);
