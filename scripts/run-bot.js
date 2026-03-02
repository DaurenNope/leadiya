/**
 * Run the WhatsApp Bot
 * 
 * Usage: node scripts/run-bot.js
 * 
 * Controls:
 *   Ctrl+C to quit
 * 
 * Commands (from WhatsApp):
 *   /help - Show commands
 *   /leads - Lead stats
 *   /top - Top leads
 *   /run - Start cycle
 *   /status - System status
 */

import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Admin phones
const ADMIN_PHONES = ['77088413062', '77754466884'];

// Commands
const commands = {
    '/help': async () => `📱 *Leadiya Bot*

Команды:
/leads - Статистика лидов
/top - Топ 5 лидов  
/run - Запустить цикл
/status - Статус системы
/help - Эта справка`,

    '/leads': async (redis) => {
        const keys = await redis.keys('sales:leads:lead_*');
        const stats = { discovered: 0, enriched: 0, qualified: 0, contacted: 0, converted: 0 };

        for (const key of keys) {
            try {
                const data = await redis.get(key);
                if (data) {
                    const lead = JSON.parse(data);
                    const state = lead.state || 'discovered';
                    if (stats[state] !== undefined) stats[state]++;
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

    '/top': async (redis) => {
        const keys = await redis.keys('sales:leads:lead_*');
        const leads = [];

        for (const key of keys.slice(0, 100)) {
            try {
                const data = await redis.get(key);
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

        leads.sort((a, b) => b.score - a.score);
        const top5 = leads.slice(0, 5);

        if (top5.length === 0) return '❌ Нет лидов';

        let result = '🎯 *Топ 5 лидов*\n\n';
        top5.forEach((lead, i) => {
            result += `${i + 1}. *${lead.name}*\n`;
            result += `   📞 ${lead.phone}\n`;
            result += `   Score: ${lead.score} | ${lead.state}\n\n`;
        });

        return result;
    },

    '/status': async (redis) => {
        const keys = await redis.keys('sales:leads:lead_*');
        return `📈 *Статус*

*Leads:* ${keys.length}
*WhatsApp:* ✅ Connected
*Bot:* ✅ Active

*Лимиты:*
• 10 msg/hour
• 30 msg/day  
• 45s delay`;
    },

    '/run': async () => {
        return `🚀 *Cycle запрошен*

Для запуска используй dashboard:
http://localhost:3000

Или curl:
curl -X POST localhost:3000/api/automation/cycle`;
    },
};

function isAdmin(phone) {
    // WhatsApp now uses LID format (e.g., 175522529153262@lid)
    // For now, allow all commands - you can restrict later
    // To restrict: compare against known LID values
    console.log(`[AUTH] Message from: ${phone}`);
    return true; // Allow all for testing
}

async function startBot() {
    console.log('\n🤖 LEADIYA WHATSAPP BOT\n');
    console.log('Connecting...\n');

    // Connect Redis
    const redis = createClient();
    await redis.connect();
    console.log('✓ Redis connected');

    // Connect WhatsApp
    const authFolder = path.join(__dirname, '../data/whatsapp_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const socket = makeWASocket({
        auth: state,
        browser: ['Leadiya Bot', 'Chrome', '121.0.0'],
        syncFullHistory: false,
    });

    socket.ev.on('creds.update', saveCreds);

    // Connection handler
    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const code = (lastDisconnect?.error)?.output?.statusCode;
            console.log(`Connection closed: ${code}`);
            if (code !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                setTimeout(startBot, 5000);
            }
        }

        if (connection === 'open') {
            console.log('✓ WhatsApp connected');
            console.log('\n📱 Bot is running! Send /help from WhatsApp\n');
            console.log('Admin phones:', ADMIN_PHONES.join(', '));
            console.log('\nPress Ctrl+C to quit\n');
        }
    });

    // Message handler
    socket.ev.on('messages.upsert', async (msg) => {
        for (const message of msg.messages) {
            if (message.key.fromMe) continue;

            const from = message.key.remoteJid || '';
            const text = message.message?.conversation ||
                message.message?.extendedTextMessage?.text || '';

            if (!text.startsWith('/')) continue;
            if (!isAdmin(from)) {
                console.log(`[IGNORED] Non-admin: ${from}`);
                continue;
            }

            console.log(`[CMD] ${from}: ${text}`);

            const cmd = text.split(/\s+/)[0].toLowerCase();
            const handler = commands[cmd];

            if (!handler) {
                await socket.sendMessage(from, { text: `❓ Неизвестная команда: ${cmd}\nОтправь /help` });
                continue;
            }

            try {
                const response = await handler(redis);
                await socket.sendMessage(from, { text: response });
                console.log(`[REPLY] Sent response for ${cmd}`);
            } catch (err) {
                console.error('[ERROR]', err);
                await socket.sendMessage(from, { text: `❌ Ошибка: ${err.message}` });
            }
        }
    });
}

startBot().catch(err => {
    console.error('Bot failed:', err);
    process.exit(1);
});
