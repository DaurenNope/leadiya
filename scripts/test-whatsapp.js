// Simple WhatsApp connection test (ES Module)
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import qr from 'qrcode-terminal';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testConnection() {
    console.log('[WA-TEST] Starting WhatsApp connection test...');

    const authFolder = path.join(__dirname, '../data/whatsapp_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Leadiya', 'Chrome', '121.0.0'],
        connectTimeoutMs: 60000,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr: qrCode } = update;

        if (qrCode) {
            console.log('\n📱 SCAN THIS QR CODE WITH YOUR WHATSAPP:\n');
            qr.generate(qrCode, { small: true });
            console.log('\n⏳ Waiting for scan... (60 second timeout)\n');
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const reason = DisconnectReason[code] || 'Unknown';
            console.log(`[WA-TEST] Connection closed: ${reason} (${code})`);

            if (code !== DisconnectReason.loggedOut) {
                console.log('[WA-TEST] Reconnecting...');
                setTimeout(testConnection, 5000);
            }
        }

        if (connection === 'open') {
            console.log('✅ [WA-TEST] CONNECTED SUCCESSFULLY!');
            console.log('[WA-TEST] WhatsApp is ready to send messages.');
            console.log('[WA-TEST] Press Ctrl+C to exit.');
        }
    });
}

testConnection().catch(err => {
    console.error('[WA-TEST] Error:', err);
    process.exit(1);
});
