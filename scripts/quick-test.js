/**
 * Quick automated test - sends one message to a lead
 */

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Russian cold outreach template
const outreachTemplate = (companyName) => `Добрый день!

Меня зовут Тимур, я из Rahmet Labs.

Мы помогаем компаниям как ${companyName} автоматизировать продажи через WhatsApp и AI:
• Автоматические ответы 24/7
• Квалификация лидов через ИИ
• Интеграция с CRM

Интересно узнать подробнее?`;

function formatPhone(phone) {
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('8') && cleaned.length === 11) {
        cleaned = '7' + cleaned.substring(1);
    }
    return cleaned;
}

async function quickTest() {
    console.log('\n🚀 QUICK PIPELINE TEST\n');

    // 1. Connect to Redis
    console.log('[1/4] Connecting to Redis...');
    const redis = createClient();
    await redis.connect();
    console.log('✓ Redis connected');

    // 2. Get first lead with phone
    console.log('[2/4] Getting a lead...');
    const keys = await redis.keys('sales:leads:lead_*');
    let targetLead = null;

    for (const key of keys.slice(0, 50)) {
        try {
            const data = await redis.get(key);
            if (data) {
                const lead = JSON.parse(data);
                if (lead.phone && lead.state === 'enriched') {
                    targetLead = lead;
                    break;
                }
            }
        } catch (e) { }
    }

    if (!targetLead) {
        console.log('✗ No suitable lead found');
        await redis.quit();
        return;
    }

    console.log(`✓ Selected: ${targetLead.companyName} (${targetLead.phone})`);

    // 3. Connect WhatsApp
    console.log('[3/4] Connecting to WhatsApp...');
    const authFolder = path.join(__dirname, '../data/whatsapp_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Leadiya Test', 'Chrome', '121.0.0'],
        connectTimeoutMs: 30000,
        syncFullHistory: false,
    });

    socket.ev.on('creds.update', saveCreds);

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 30000);
        socket.ev.on('connection.update', (update) => {
            if (update.connection === 'open') {
                clearTimeout(timeout);
                console.log('✓ WhatsApp connected');
                resolve();
            }
        });
    });

    // 4. Send message
    console.log('[4/4] Sending outreach message...');
    const phone = formatPhone(targetLead.phone);
    const jid = phone + '@s.whatsapp.net';
    const message = outreachTemplate(targetLead.companyName);

    console.log('\n--- MESSAGE ---');
    console.log(`To: ${targetLead.companyName} (+${phone})`);
    console.log(message);
    console.log('--- END ---\n');

    await socket.sendMessage(jid, { text: message });

    console.log('✅ MESSAGE SENT SUCCESSFULLY!\n');
    console.log('Lead details:');
    console.log(`  Company: ${targetLead.companyName}`);
    console.log(`  Phone: ${targetLead.phone}`);
    console.log(`  Email: ${targetLead.email || 'N/A'}`);
    console.log(`  Source: ${targetLead.source}`);

    // Cleanup
    await new Promise(r => setTimeout(r, 2000));
    await redis.quit();
    socket.end();

    console.log('\n🎉 Test complete! Check WhatsApp for the sent message.\n');
    process.exit(0);
}

quickTest().catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
});
