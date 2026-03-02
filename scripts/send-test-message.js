// Send a test WhatsApp message
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get phone number from command line argument
const targetPhone = process.argv[2];

if (!targetPhone) {
    console.log('Usage: node scripts/send-test-message.js <phone_number>');
    console.log('Example: node scripts/send-test-message.js 77001234567');
    process.exit(1);
}

// Format phone number (remove + and spaces)
const formattedPhone = targetPhone.replace(/[^0-9]/g, '');

async function sendTestMessage() {
    console.log(`[TEST] Loading WhatsApp session...`);

    const authFolder = path.join(__dirname, '../data/whatsapp_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Leadiya', 'Chrome', '121.0.0'],
        connectTimeoutMs: 30000,
        syncFullHistory: false,
    });

    socket.ev.on('creds.update', saveCreds);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Connection timeout after 30s'));
        }, 30000);

        socket.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                clearTimeout(timeout);
                reject(new Error(`Connection closed: ${code}`));
            }

            if (connection === 'open') {
                clearTimeout(timeout);
                console.log(`[TEST] Connected! Sending test message...`);

                try {
                    const jid = formattedPhone + '@s.whatsapp.net';

                    // Test message in Russian
                    const message = `🧪 Тестовое сообщение от Leadiya CRM

Привет! Это автоматический тест системы.
Время: ${new Date().toLocaleString('ru-RU')}

-- 
Rahmet Labs`;

                    await socket.sendMessage(jid, { text: message });

                    console.log(`✅ [TEST] Message sent successfully to ${formattedPhone}!`);

                    // Wait a bit before closing
                    await new Promise(r => setTimeout(r, 2000));

                    resolve(true);
                    process.exit(0);

                } catch (err) {
                    console.error(`❌ [TEST] Send failed:`, err);
                    reject(err);
                }
            }
        });
    });
}

sendTestMessage().catch(err => {
    console.error('[TEST] Error:', err.message);
    process.exit(1);
});
