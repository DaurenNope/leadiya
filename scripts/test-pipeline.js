/**
 * Interactive Pipeline Test
 * Tests the full lead-to-outreach pipeline with WhatsApp
 * 
 * Usage: node scripts/test-pipeline.js [phone_to_contact]
 */

import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from 'redis';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

const log = {
    info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    step: (num, msg) => console.log(`\n${colors.cyan}[Step ${num}]${colors.reset} ${colors.bright}${msg}${colors.reset}`),
};

// Russian cold outreach template
const outreachTemplate = (companyName) => `Добрый день!

Меня зовут Тимур, я из Rahmet Labs.

Мы помогаем компаниям как ${companyName} автоматизировать продажи через WhatsApp и AI:
• Автоматические ответы 24/7
• Квалификация лидов через ИИ
• Интеграция с CRM

Интересно узнать подробнее?`;

class PipelineTest {
    constructor() {
        this.socket = null;
        this.redis = null;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async prompt(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer.trim());
            });
        });
    }

    async connectRedis() {
        log.step(1, 'Connecting to Redis...');
        this.redis = createClient();
        await this.redis.connect();
        log.success('Redis connected');
    }

    async getLeads() {
        log.step(2, 'Fetching leads from database...');

        // Get only actual lead keys (contain lead_ in the key name)
        const allKeys = await this.redis.keys('sales:leads:lead_*');
        const leads = [];

        for (const key of allKeys) {
            try {
                const data = await this.redis.get(key);
                if (data) {
                    const lead = JSON.parse(data);
                    if (lead.phone) {
                        leads.push(lead);
                    }
                }
            } catch (e) {
                // Skip non-string keys
            }
        }

        log.success(`Found ${leads.length} leads with phone numbers`);
        return leads;
    }

    async selectLead(leads) {
        log.step(3, 'Select a lead to contact...');

        console.log('\n' + colors.bright + 'Available leads:' + colors.reset);
        leads.slice(0, 10).forEach((lead, i) => {
            const phone = lead.phone || 'N/A';
            const state = lead.state || 'discovered';
            console.log(`  ${i + 1}. ${lead.companyName} - ${phone} [${state}]`);
        });

        const choice = await this.prompt('\nEnter lead number (or phone to contact manually): ');

        if (/^\d+$/.test(choice) && parseInt(choice) <= leads.length) {
            return leads[parseInt(choice) - 1];
        } else if (/^[0-9+]+$/.test(choice)) {
            return { companyName: 'Test Company', phone: choice };
        }

        return leads[0];
    }

    async connectWhatsApp() {
        log.step(4, 'Connecting to WhatsApp...');

        const authFolder = path.join(__dirname, '../data/whatsapp_auth');
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);

        this.socket = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Leadiya Pipeline Test', 'Chrome', '121.0.0'],
            connectTimeoutMs: 30000,
            syncFullHistory: false,
        });

        this.socket.ev.on('creds.update', saveCreds);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WhatsApp connection timeout'));
            }, 30000);

            this.socket.ev.on('connection.update', (update) => {
                if (update.qr) {
                    log.info('Scan the QR code with your WhatsApp');
                }
                if (update.connection === 'open') {
                    clearTimeout(timeout);
                    log.success('WhatsApp connected!');
                    resolve();
                }
                if (update.connection === 'close') {
                    const code = update.lastDisconnect?.error?.output?.statusCode;
                    if (code !== 515 && code !== 440) {
                        clearTimeout(timeout);
                        reject(new Error(`Connection closed: ${code}`));
                    }
                }
            });
        });
    }

    formatPhone(phone) {
        // Clean and format for Kazakhstan
        let cleaned = phone.replace(/[^0-9]/g, '');
        if (cleaned.startsWith('8') && cleaned.length === 11) {
            cleaned = '7' + cleaned.substring(1);
        }
        return cleaned;
    }

    async sendOutreach(lead) {
        log.step(5, `Sending outreach to ${lead.companyName}...`);

        const phone = this.formatPhone(lead.phone);
        const jid = phone + '@s.whatsapp.net';
        const message = outreachTemplate(lead.companyName);

        console.log('\n' + colors.yellow + '--- Message Preview ---' + colors.reset);
        console.log(message);
        console.log(colors.yellow + '--- End Preview ---' + colors.reset + '\n');

        const confirm = await this.prompt(`Send to +${phone}? (y/n): `);

        if (confirm.toLowerCase() !== 'y') {
            log.warn('Cancelled by user');
            return false;
        }

        try {
            await this.socket.sendMessage(jid, { text: message });
            log.success(`Message sent to ${lead.companyName} (+${phone})`);
            return true;
        } catch (error) {
            log.error(`Failed to send: ${error.message}`);
            return false;
        }
    }

    async listenForReply(phone, timeout = 60000) {
        log.step(6, 'Waiting for reply...');

        const jid = this.formatPhone(phone) + '@s.whatsapp.net';

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                log.warn('No reply received within timeout');
                resolve(null);
            }, timeout);

            const handler = (event) => {
                for (const msg of event.messages) {
                    if (msg.key.remoteJid === jid && !msg.key.fromMe) {
                        clearTimeout(timer);
                        const text = msg.message?.conversation ||
                            msg.message?.extendedTextMessage?.text ||
                            '[Non-text message]';
                        log.success(`Reply received: "${text}"`);
                        resolve(text);
                        return;
                    }
                }
            };

            this.socket.ev.on('messages.upsert', handler);
        });
    }

    async cleanup() {
        if (this.redis) await this.redis.quit();
        if (this.socket) this.socket.end();
        this.rl.close();
    }

    async run() {
        console.log('\n' + colors.bright + colors.cyan + '═══════════════════════════════════════════════' + colors.reset);
        console.log(colors.bright + '     LEADIYA PIPELINE TEST - Live Outreach     ' + colors.reset);
        console.log(colors.bright + colors.cyan + '═══════════════════════════════════════════════' + colors.reset + '\n');

        try {
            await this.connectRedis();
            const leads = await this.getLeads();

            if (leads.length === 0) {
                log.warn('No leads with phone numbers found. Enter a phone manually.');
            }

            const lead = await this.selectLead(leads);
            log.info(`Selected: ${lead.companyName} (${lead.phone})`);

            await this.connectWhatsApp();

            const sent = await this.sendOutreach(lead);

            if (sent) {
                console.log('\n' + colors.cyan + 'Listening for replies... (60s timeout, Ctrl+C to exit)' + colors.reset);
                await this.listenForReply(lead.phone);
            }

            console.log('\n' + colors.green + colors.bright + '✓ Test complete!' + colors.reset + '\n');

        } catch (error) {
            log.error(`Test failed: ${error.message}`);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test
const test = new PipelineTest();
test.run();
