/**
 * Telegram MTProto Scraper
 * Uses Telegram's actual API to get group/channel members
 * Requires user login (phone number + code)
 * 
 * First run: Will prompt for phone number and verification code
 * Subsequent runs: Uses saved session
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as readline from 'readline';
import { leads } from './leads.js';
import * as fs from 'fs';
import * as path from 'path';

// Telegram API credentials - get from https://my.telegram.org
const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// Session file path
const SESSION_FILE = path.join(process.cwd(), 'config', 'telegram-session.txt');

// Target groups/channels (username without @)
const TARGET_GROUPS = [
    // Kazakhstan
    'bizkazakhstan',
    'startupsalmaty',
    'italmaty',
    'digitalkazakhstan',

    // Russian business
    'startupoftheday',
    'rusbase',
    'vcru',
    'biznes_kanal',
    'startupforkids',

    // Add your own groups here
];

interface TelegramUser {
    id: number;
    username: string;
    firstName: string;
    lastName: string;
    phone?: string;
}

/**
 * Get saved session or empty
 */
function getSession(): string {
    try {
        if (fs.existsSync(SESSION_FILE)) {
            return fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        }
    } catch (e) { }
    return '';
}

/**
 * Save session for future use
 */
function saveSession(session: string) {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, session);
}

/**
 * Prompt for user input
 */
async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Create authenticated Telegram client
 */
async function createClient(): Promise<TelegramClient> {
    if (!API_ID || !API_HASH) {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║  TELEGRAM API CREDENTIALS REQUIRED                        ║
╠════════════════════════════════════════════════════════════╣
║  1. Go to https://my.telegram.org                         ║
║  2. Log in with your phone number                         ║
║  3. Go to "API development tools"                         ║
║  4. Create an application if you haven't                  ║
║  5. Copy api_id and api_hash                              ║
║                                                           ║
║  Then add to your .env file:                              ║
║    TELEGRAM_API_ID=your_api_id                            ║
║    TELEGRAM_API_HASH=your_api_hash                        ║
╚════════════════════════════════════════════════════════════╝
        `);
        throw new Error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH');
    }

    const session = new StringSession(getSession());
    const client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await prompt('Enter your phone number: '),
        password: async () => await prompt('Enter your 2FA password (if any): '),
        phoneCode: async () => await prompt('Enter the code you received: '),
        onError: (err) => console.error('Auth error:', err),
    });

    // Save session for future use
    const sessionString = client.session.save() as unknown as string;
    saveSession(sessionString);
    console.log('[TG_MTProto] Logged in successfully. Session saved.');

    return client;
}

/**
 * Get members from a group/channel
 */
async function getGroupMembers(client: TelegramClient, groupUsername: string): Promise<TelegramUser[]> {
    const users: TelegramUser[] = [];

    try {
        const entity = await client.getEntity(groupUsername);

        if (!entity) {
            console.log(`[TG_MTProto] Could not find: ${groupUsername}`);
            return [];
        }

        // Get participants
        const participants = await client.getParticipants(entity, {
            limit: 200, // Telegram limits
        });

        for (const p of participants) {
            if (p instanceof Api.User) {
                users.push({
                    id: Number(p.id),
                    username: p.username || '',
                    firstName: p.firstName || '',
                    lastName: p.lastName || '',
                    phone: p.phone || '',
                });
            }
        }

        console.log(`[TG_MTProto] Got ${users.length} members from ${groupUsername}`);
    } catch (e: any) {
        if (e.message?.includes('CHAT_ADMIN_REQUIRED')) {
            console.log(`[TG_MTProto] Need admin rights for ${groupUsername}`);
        } else if (e.message?.includes('CHANNEL_PRIVATE')) {
            console.log(`[TG_MTProto] Cannot access private channel: ${groupUsername}`);
        } else {
            console.error(`[TG_MTProto] Error with ${groupUsername}:`, e.message);
        }
    }

    return users;
}

/**
 * Main scraper function
 */
export async function scrapeTelegramMTProto(): Promise<number> {
    console.log('[TG_MTProto] Starting Telegram MTProto scraper...');

    const client = await createClient();
    await leads.connect();

    const allUsers: TelegramUser[] = [];
    const seenIds = new Set<number>();

    try {
        for (const group of TARGET_GROUPS) {
            console.log(`[TG_MTProto] Scraping: ${group}`);

            const members = await getGroupMembers(client, group);

            for (const m of members) {
                if (!seenIds.has(m.id)) {
                    seenIds.add(m.id);
                    allUsers.push(m);
                }
            }

            // Rate limit - be nice to Telegram
            await new Promise(r => setTimeout(r, 2000));
        }
    } finally {
        await client.disconnect();
    }

    console.log(`[TG_MTProto] Total unique users: ${allUsers.length}`);

    // Save as leads
    let saved = 0;
    for (const user of allUsers) {
        if (!user.username && !user.phone) continue; // Skip if no contact

        const lead = {
            firstName: user.firstName,
            lastName: user.lastName,
            companyName: user.username ? `@${user.username}` : `TG User ${user.id}`,
            email: '',
            phone: user.phone || '',
            website: user.username ? `https://t.me/${user.username}` : '',
            source: 'scrape' as const,
            state: 'discovered' as const,
            tags: ['telegram', 'mtproto', 'group_member'],
            notes: [
                `Telegram ID: ${user.id}`,
                user.username ? `Username: @${user.username}` : '',
                user.phone ? `Phone: ${user.phone}` : '',
            ].filter(Boolean),
        };

        await leads.create(lead);
        saved++;
    }

    console.log(`[TG_MTProto] Saved ${saved} leads`);
    return saved;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    scrapeTelegramMTProto()
        .then(() => process.exit(0))
        .catch(e => { console.error(e); process.exit(1); });
}
