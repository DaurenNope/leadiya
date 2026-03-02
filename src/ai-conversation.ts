/**
 * AI Sales Conversation Handler
 * Handles WhatsApp conversations with AI-generated responses
 * 
 * Flow: Initial Message → AI handles replies → Qualifies → Books meeting
 */
import Anthropic from '@anthropic-ai/sdk';
import { leads } from './leads.js';
import { whatsapp } from './channels/whatsapp.js';
import type { Lead } from './types.js';

const anthropic = new Anthropic();

interface ConversationState {
    stage: 'initial' | 'qualifying' | 'interested' | 'meeting_booked' | 'not_interested';
    messages: { role: 'user' | 'assistant'; content: string }[];
    lastContact: Date;
}

// In-memory conversation store (use Redis for production)
const conversations = new Map<string, ConversationState>();

// Company info for the AI
const COMPANY_CONTEXT = `
Ты - менеджер по продажам из RahmetLabs (продуктовая студия).

ЧТО МЫ ДЕЛАЕМ:
- Автоматизация бизнес-процессов (чат-боты, CRM интеграции)
- Разработка сайтов и веб-приложений
- Интеграции с 1С, WhatsApp, Telegram
- AI решения для бизнеса

НАШИ КЕЙСЫ:
- Q University - чат-бот для абитуриентов (автоматизировали 70% обращений)
- [Другие кейсы можно добавить]

ТВОЯ ЗАДАЧА:
1. Выяснить боли клиента (с чем сложно, что хотят автоматизировать)
2. Понять бюджет и сроки
3. Назначить звонок с основателем

ПРАВИЛА:
- Пиши коротко (1-3 предложения)
- Не впаривай, а выясняй потребности
- Если не интересно - вежливо прощайся
- Если интересно - предлагай 15-минутный звонок
`;

export async function generateAIResponse(
    lead: Lead,
    incomingMessage: string
): Promise<string> {
    const state = conversations.get(lead.id) || {
        stage: 'qualifying',
        messages: [],
        lastContact: new Date()
    };

    // Add incoming message to history
    state.messages.push({ role: 'user', content: incomingMessage });

    // Build conversation for Claude
    const systemPrompt = `${COMPANY_CONTEXT}

ИНФОРМАЦИЯ О КЛИЕНТЕ:
- Компания: ${lead.companyName || 'Неизвестно'}
- Контакт: ${lead.firstName || ''} ${lead.lastName || ''}
- Сфера: ${lead.signalSummary || 'Неизвестно'}

ТЕКУЩАЯ СТАДИЯ: ${state.stage}
`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            system: systemPrompt,
            messages: state.messages.map(m => ({
                role: m.role,
                content: m.content
            }))
        });

        const aiMessage = response.content[0].type === 'text'
            ? response.content[0].text
            : '';

        // Add AI response to history
        state.messages.push({ role: 'assistant', content: aiMessage });
        state.lastContact = new Date();

        // Update stage based on keywords
        const lowerMessage = incomingMessage.toLowerCase();
        if (lowerMessage.includes('не интересно') || lowerMessage.includes('нет') && state.messages.length <= 3) {
            state.stage = 'not_interested';
        } else if (lowerMessage.includes('созвон') || lowerMessage.includes('звонок') || lowerMessage.includes('встреч')) {
            state.stage = 'meeting_booked';
        } else if (lowerMessage.includes('интересно') || lowerMessage.includes('расскажите')) {
            state.stage = 'interested';
        }

        // Save state
        conversations.set(lead.id, state);

        // Update lead state in DB
        if (state.stage === 'meeting_booked') {
            await leads.update(lead.id, { state: 'qualified' });
        } else if (state.stage === 'not_interested') {
            await leads.update(lead.id, { state: 'closed_lost' });
        }

        return aiMessage;

    } catch (error) {
        console.error('AI generation failed:', error);
        return 'Спасибо за ответ! Передам вашу информацию менеджеру и свяжемся с вами.';
    }
}

// Send initial outreach message
export async function sendInitialMessage(leadId: string): Promise<boolean> {
    const lead = await leads.get(leadId);
    if (!lead) {
        console.log(`Lead ${leadId} not found`);
        return false;
    }

    // Compose initial message (personalized)
    const initialMessage = `Здравствуйте! 👋

Это RahmetLabs — делаем автоматизацию для бизнеса.

${lead.signalSummary?.includes('education') || lead.companyName?.toLowerCase().includes('universi')
            ? 'Работали с Q University — сделали чат-бота для абитуриентов, который обрабатывает 70% обращений автоматически.'
            : 'Помогаем компаниям автоматизировать рутину — чат-боты, интеграции с 1С, CRM.'
        }

Есть ли у вас задачи, которые хотелось бы автоматизировать?`;

    // Initialize conversation state
    conversations.set(lead.id, {
        stage: 'initial',
        messages: [{ role: 'assistant', content: initialMessage }],
        lastContact: new Date()
    });

    // Send via WhatsApp
    const result = await whatsapp.send(lead, initialMessage);

    if (result.success) {
        console.log(`✓ Sent initial message to ${lead.companyName}`);
        await leads.update(lead.id, {
            state: 'contacted',
            lastContactedAt: new Date()
        });
        return true;
    } else {
        console.log(`✗ Failed to send to ${lead.companyName}: ${result.error}`);
        return false;
    }
}

// Handle incoming WhatsApp message (webhook callback)
export async function handleIncomingMessage(
    phoneNumber: string,
    message: string
): Promise<void> {
    // Find lead by phone
    const allLeads = await leads.getByState('contacted');
    const lead = allLeads.find(l =>
        l.phone?.replace(/\D/g, '').endsWith(phoneNumber.replace(/\D/g, '').slice(-10))
    );

    if (!lead) {
        console.log(`No lead found for phone: ${phoneNumber}`);
        return;
    }

    console.log(`📩 Incoming from ${lead.companyName}: ${message}`);

    // Generate AI response
    const response = await generateAIResponse(lead, message);

    // Send response
    const result = await whatsapp.send(lead, response);

    if (result.success) {
        console.log(`✓ AI replied to ${lead.companyName}: ${response.substring(0, 50)}...`);
    }
}

// Batch send initial messages to leads
export async function startOutreachCampaign(
    limit: number = 10,
    delayMs: number = 30000 // 30 seconds between messages
): Promise<{ sent: number; failed: number }> {
    const discoveredLeads = await leads.getByState('discovered');

    // Filter for KZ leads with phone
    const kzLeads = discoveredLeads.filter(l =>
        l.phone &&
        (l.phone.startsWith('+7') || l.phone.startsWith('7')) &&
        l.signalSummary
    );

    console.log(`\n🚀 Starting outreach campaign`);
    console.log(`   ${kzLeads.length} eligible leads, sending to ${Math.min(limit, kzLeads.length)}`);
    console.log('');

    let sent = 0;
    let failed = 0;

    for (const lead of kzLeads.slice(0, limit)) {
        const success = await sendInitialMessage(lead.id);
        if (success) {
            sent++;
        } else {
            failed++;
        }

        console.log(`   Progress: ${sent + failed}/${Math.min(limit, kzLeads.length)}`);

        // Rate limit
        if (sent + failed < limit) {
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    console.log(`\n✅ Campaign complete: ${sent} sent, ${failed} failed`);
    return { sent, failed };
}

// Export for CLI testing
export const aiConversation = {
    generateAIResponse,
    sendInitialMessage,
    handleIncomingMessage,
    startOutreachCampaign,
    getConversation: (leadId: string) => conversations.get(leadId)
};
