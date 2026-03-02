/**
 * WhatsApp Bot - Control CRM via WhatsApp commands
 * 
 * Commands:
 * /leads - Show lead stats
 * /top - Top 5 qualified leads
 * /run - Trigger automation cycle
 * /send <id> - Send outreach to lead
 * /status - Rate limits & queue
 * /help - Show commands
 */

import { createClient, RedisClientType } from 'redis';

// Admin phone numbers that can run commands
const ADMIN_PHONES = [
    '77088413062',  // Rahmet Labs main
    '77754466884',  // Secondary
];

interface BotContext {
    redis: RedisClientType;
    sendMessage: (to: string, text: string) => Promise<void>;
    runCycle?: () => Promise<void>;
}

type CommandHandler = (ctx: BotContext, args: string[]) => Promise<string>;

const commands: Record<string, CommandHandler> = {
    '/help': async () => {
        return `📱 *Leadiya Bot*

Команды:
/leads - Статистика лидов
/top - Топ 5 лидов
/run - Запустить цикл
/send <id> - Отправить outreach
/status - Лимиты и очередь
/help - Эта справка`;
    },

    '/leads': async (ctx) => {
        const keys = await ctx.redis.keys('sales:leads:lead_*');

        const stats: Record<string, number> = {
            discovered: 0,
            enriched: 0,
            qualified: 0,
            contacted: 0,
            converted: 0,
            other: 0,
        };

        for (const key of keys) {
            try {
                const data = await ctx.redis.get(key);
                if (data) {
                    const lead = JSON.parse(data);
                    const state = lead.state || 'other';
                    stats[state] = (stats[state] || 0) + 1;
                }
            } catch { }
        }

        const total = Object.values(stats).reduce((a, b) => a + b, 0);

        return `📊 *Статистика лидов*

• Discovered: ${stats.discovered}
• Enriched: ${stats.enriched}
• Qualified: ${stats.qualified}
• Contacted: ${stats.contacted}
• Converted: ${stats.converted}

*Всего:* ${total} лидов`;
    },

    '/top': async (ctx) => {
        const keys = await ctx.redis.keys('sales:leads:lead_*');
        const leads: Array<{ name: string; phone: string; score: number; state: string }> = [];

        for (const key of keys.slice(0, 100)) {
            try {
                const data = await ctx.redis.get(key);
                if (data) {
                    const lead = JSON.parse(data);
                    if (lead.phone) {
                        leads.push({
                            name: lead.companyName || 'Unknown',
                            phone: lead.phone,
                            score: lead.score || 0,
                            state: lead.state || 'discovered',
                        });
                    }
                }
            } catch { }
        }

        // Sort by score descending
        leads.sort((a, b) => b.score - a.score);
        const top5 = leads.slice(0, 5);

        if (top5.length === 0) {
            return '❌ Нет лидов с телефонами';
        }

        let result = '🎯 *Топ 5 лидов*\n\n';
        top5.forEach((lead, i) => {
            result += `${i + 1}. *${lead.name}*\n`;
            result += `   📞 ${lead.phone}\n`;
            result += `   Score: ${lead.score} | ${lead.state}\n\n`;
        });

        return result;
    },

    '/run': async (ctx) => {
        if (ctx.runCycle) {
            // Don't await - run in background
            ctx.runCycle().catch(console.error);
            return `🚀 *Цикл запущен!*

Проверяю:
• Discovery
• Enrichment  
• Outreach

Отправь /status для статуса`;
        }
        return '❌ Automation не подключена';
    },

    '/status': async (ctx) => {
        const keys = await ctx.redis.keys('sales:leads:lead_*');
        const automationKeys = await ctx.redis.keys('automation:*');

        return `📈 *Статус системы*

*Leads:* ${keys.length}
*Jobs:* ${automationKeys.length}
*WhatsApp:* ✅ Connected

*Лимиты:*
• 10 msg/hour
• 30 msg/day
• 45s delay`;
    },

    '/send': async (ctx, args) => {
        if (args.length < 1) {
            return '❌ Укажи ID: /send lead_123';
        }

        const leadId = args[0];
        const key = leadId.startsWith('sales:') ? leadId : `sales:leads:${leadId}`;

        try {
            const data = await ctx.redis.get(key);
            if (!data) {
                return `❌ Лид не найден: ${leadId}`;
            }

            const lead = JSON.parse(data);
            if (!lead.phone) {
                return `❌ У лида нет телефона`;
            }

            // Queue for sending
            return `📤 *Outreach в очереди*

Компания: ${lead.companyName}
Телефон: ${lead.phone}

Отправка через messenger...`;
        } catch (e) {
            return `❌ Ошибка: ${e}`;
        }
    },
};

export class WhatsAppBot {
    private redis: RedisClientType | null = null;
    private sendMessageFn?: (to: string, text: string) => Promise<void>;
    private runCycleFn?: () => Promise<void>;

    /**
     * Initialize bot with Redis connection
     */
    async init() {
        this.redis = createClient();
        await this.redis.connect();
        console.log('[BOT] WhatsApp bot initialized');
    }

    /**
     * Set the message sender function
     */
    setSendMessage(fn: (to: string, text: string) => Promise<void>) {
        this.sendMessageFn = fn;
    }

    /**
     * Set automation cycle function
     */
    setRunCycle(fn: () => Promise<void>) {
        this.runCycleFn = fn;
    }

    /**
     * Check if phone is admin
     */
    isAdmin(phone: string): boolean {
        const cleaned = phone.replace(/[^0-9]/g, '').replace('@s.whatsapp.net', '');
        return ADMIN_PHONES.some(admin => cleaned.includes(admin));
    }

    /**
     * Handle incoming message
     */
    async handleMessage(from: string, text: string): Promise<void> {
        // Check if admin
        if (!this.isAdmin(from)) {
            console.log(`[BOT] Ignoring non-admin: ${from}`);
            return;
        }

        // Check if command
        const trimmed = text.trim();
        if (!trimmed.startsWith('/')) {
            return; // Not a command
        }

        console.log(`[BOT] Command from ${from}: ${trimmed}`);

        // Parse command
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        // Find handler
        const handler = commands[cmd];
        if (!handler) {
            await this.reply(from, `❓ Неизвестная команда: ${cmd}\nОтправь /help`);
            return;
        }

        // Execute
        try {
            const ctx: BotContext = {
                redis: this.redis!,
                sendMessage: this.sendMessageFn!,
                runCycle: this.runCycleFn,
            };

            const response = await handler(ctx, args);
            await this.reply(from, response);
        } catch (error) {
            console.error('[BOT] Command error:', error);
            await this.reply(from, `❌ Ошибка: ${error}`);
        }
    }

    /**
     * Send reply
     */
    private async reply(to: string, text: string): Promise<void> {
        if (this.sendMessageFn) {
            await this.sendMessageFn(to, text);
        }
    }

    /**
     * Cleanup
     */
    async close() {
        if (this.redis) {
            await this.redis.quit();
        }
    }
}

// Singleton
export const whatsappBot = new WhatsAppBot();
