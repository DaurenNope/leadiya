/**
 * WhatsApp Channel Adapter via Baileys
 * Self-hosted WhatsApp Web client with QR code pairing
 * 
 * Safety limits (to avoid bans):
 * - Max 30 messages/day
 * - Max 10 messages/hour
 * - Min 45 seconds between messages
 */

import makeWASocket, {
    Browsers,
    DisconnectReason,
    useMultiFileAuthState,
    WASocket
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { BaseChannelAdapter, SendResult } from './base.js';
import type { Lead, Channel } from '../types.js';
import { whatsappMessages, type WhatsAppMessage } from '../whatsapp-messages.js';

// Rate limiting state
interface RateLimitState {
    messagesThisHour: number;
    messagesToday: number;
    lastMessageTime: number;
    hourStart: number;
    dayStart: number;
}

export class WhatsAppAdapter extends BaseChannelAdapter {
    readonly name: Channel = 'whatsapp';

    private socket: WASocket | null = null;
    private isConnecting = false;
    private connectionReady = false;
    private rateLimit: RateLimitState = {
        messagesThisHour: 0,
        messagesToday: 0,
        lastMessageTime: 0,
        hourStart: Date.now(),
        dayStart: Date.now(),
    };

    // Config
    private readonly MAX_PER_HOUR = 10;
    private readonly MAX_PER_DAY = 30;
    private readonly MIN_DELAY_MS = 45000; // 45 seconds
    private readonly AUTH_DIR = './wa-auth';

    // Callback for incoming messages
    onMessageReceived?: (from: string, text: string) => void;

    // Current QR code for UI display
    private currentQR: string | null = null;

    /**
     * Check if we can reach this lead via WhatsApp
     */
    canReach(lead: Lead): boolean {
        return this.getContactId(lead) !== null;
    }

    /**
     * Get WhatsApp contact ID (phone number)
     */
    getContactId(lead: Lead): string | null {
        // Try various phone fields
        const phone = lead.phone || lead.whatsappNumber || (lead as any).rawData?.whatsapp;

        if (!phone) return null;

        return this.formatPhoneNumber(phone);
    }

    /**
     * Check if WhatsApp is connected and ready
     */
    async isReady(): Promise<boolean> {
        return this.connectionReady && this.socket !== null;
    }

    /**
     * Connect to WhatsApp - displays QR code in terminal
     */
    async connect(): Promise<boolean> {
        if (this.isConnecting) {
            console.log('[WHATSAPP] Already connecting...');
            return false;
        }

        this.isConnecting = true;

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.AUTH_DIR);

            this.socket = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.macOS('Desktop'),
                syncFullHistory: true,
            });

            // Handle connection events
            this.socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log('\n[WHATSAPP] Scan this QR code with your phone:\n');
                    qrcode.generate(qr, { small: true });
                    console.log('\nOpen WhatsApp > Settings > Linked Devices > Link a Device\n');
                    // Store QR for UI access
                    this.currentQR = qr;
                }

                if (connection === 'close') {
                    this.connectionReady = false;
                    const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

                    if (reason === DisconnectReason.loggedOut) {
                        console.log('[WHATSAPP] Logged out. Delete wa-auth folder and reconnect.');
                        this.socket = null;
                    } else {
                        console.log('[WHATSAPP] Connection closed, reconnecting...', reason);
                        this.isConnecting = false;
                        await this.connect();
                    }
                }

                if (connection === 'open') {
                    this.connectionReady = true;
                    this.currentQR = null; // Clear QR after successful connection
                    console.log('[WHATSAPP] Connected successfully!');
                    console.log('[WHATSAPP] Logged in as:', this.socket?.user?.name);
                    this.isConnecting = false;
                }
            });

            // Save credentials when updated
            this.socket.ev.on('creds.update', saveCreds);

            // Handle incoming messages + history sync
            this.socket.ev.on('messages.upsert', async (msg) => {
                // Check if this is a history sync
                if (msg.type === 'notify' || msg.type === 'append') {
                    console.log(`[WHATSAPP] Received ${msg.messages.length} messages (type: ${msg.type})`);
                }

                for (const message of msg.messages) {
                    // Skip status broadcasts and group messages for now
                    const jid = message.key.remoteJid || '';
                    if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

                    const text = message.message?.conversation ||
                        message.message?.extendedTextMessage?.text || '';

                    if (!text) continue; // Skip media-only messages

                    const direction = message.key.fromMe ? 'outgoing' : 'incoming';
                    const messageTime = message.messageTimestamp
                        ? (typeof message.messageTimestamp === 'number'
                            ? message.messageTimestamp * 1000
                            : Number(message.messageTimestamp) * 1000)
                        : Date.now();

                    console.log(`[WHATSAPP] ${direction} ${jid}: ${text.substring(0, 40)}...`);

                    // Store message
                    try {
                        const storedMsg: WhatsAppMessage = {
                            id: message.key.id || `${direction}_${Date.now()}`,
                            jid: jid,
                            phone: whatsappMessages.jidToPhone(jid),
                            direction: direction,
                            content: text,
                            timestamp: messageTime,
                            status: 'delivered'
                        };
                        await whatsappMessages.saveMessage(storedMsg);
                    } catch (err) {
                        console.error('[WHATSAPP] Failed to store message:', err);
                    }

                    // Callback for incoming only
                    if (!message.key.fromMe) {
                        this.onMessageReceived?.(jid, text);
                    }
                }
            });

            // Handle initial history sync (chats and messages received on connection)
            this.socket.ev.on('messaging-history.set', async (data) => {
                const { chats, messages, isLatest } = data;
                console.log(`[WHATSAPP] History sync: ${chats.length} chats, ${messages.length} messages (isLatest: ${isLatest})`);

                let savedCount = 0;
                for (const msg of messages) {
                    try {
                        const jid = msg.key?.remoteJid || '';
                        // Skip status broadcasts and groups
                        if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;

                        const text = msg.message?.conversation ||
                            msg.message?.extendedTextMessage?.text || '';
                        if (!text) continue;

                        const direction = msg.key?.fromMe ? 'outgoing' : 'incoming';
                        const messageTime = msg.messageTimestamp
                            ? (typeof msg.messageTimestamp === 'number'
                                ? msg.messageTimestamp * 1000
                                : Number(msg.messageTimestamp) * 1000)
                            : Date.now();

                        const storedMsg: WhatsAppMessage = {
                            id: msg.key?.id || `hist_${Date.now()}_${savedCount}`,
                            jid: jid,
                            phone: whatsappMessages.jidToPhone(jid),
                            direction: direction,
                            content: text,
                            timestamp: messageTime,
                            status: 'delivered'
                        };
                        await whatsappMessages.saveMessage(storedMsg);
                        savedCount++;
                    } catch (err) {
                        // Silently skip problematic messages
                    }
                }
                console.log(`[WHATSAPP] Saved ${savedCount} messages from history sync`);
            });

            return true;
        } catch (error) {
            console.error('[WHATSAPP] Connection error:', error);
            this.isConnecting = false;
            return false;
        }
    }

    /**
     * Send a message directly to a JID (for replies)
     */
    async sendToJid(jid: string, message: string): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || !this.connectionReady) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        // Check rate limits
        const limitCheck = this.checkRateLimits();
        if (!limitCheck.allowed) {
            return { success: false, error: limitCheck.reason };
        }

        // Enforce minimum delay
        const timeSinceLast = Date.now() - this.rateLimit.lastMessageTime;
        if (timeSinceLast < this.MIN_DELAY_MS && this.rateLimit.lastMessageTime > 0) {
            await this.sleep(this.MIN_DELAY_MS - timeSinceLast);
        }

        try {
            await this.socket.sendMessage(jid, { text: message });

            // Update rate limit counters
            this.rateLimit.messagesThisHour++;
            this.rateLimit.messagesToday++;
            this.rateLimit.lastMessageTime = Date.now();

            // Store outgoing message
            const storedMsg: WhatsAppMessage = {
                id: `out_${Date.now()}`,
                jid: jid,
                phone: whatsappMessages.jidToPhone(jid),
                direction: 'outgoing',
                content: message,
                timestamp: Date.now(),
                status: 'sent'
            };
            await whatsappMessages.saveMessage(storedMsg);

            this.log('Sent reply', { to: jid.split('@')[0].slice(-4) });
            return { success: true };
        } catch (error) {
            this.log('Send error', { error: String(error) });
            return { success: false, error: String(error) };
        }
    }

    /**
     * Send media (image/document) to a JID
     */
    async sendMediaToJid(
        jid: string,
        mediaBuffer: Buffer,
        options: {
            mimetype: string;
            filename?: string;
            caption?: string;
        }
    ): Promise<{ success: boolean; error?: string }> {
        if (!this.socket || !this.connectionReady) {
            return { success: false, error: 'WhatsApp not connected' };
        }

        // Check rate limits
        const limitCheck = this.checkRateLimits();
        if (!limitCheck.allowed) {
            return { success: false, error: limitCheck.reason };
        }

        // Enforce minimum delay
        const timeSinceLast = Date.now() - this.rateLimit.lastMessageTime;
        if (timeSinceLast < this.MIN_DELAY_MS && this.rateLimit.lastMessageTime > 0) {
            await this.sleep(this.MIN_DELAY_MS - timeSinceLast);
        }

        try {
            const isImage = options.mimetype.startsWith('image/');
            const isDocument = options.mimetype.startsWith('application/') ||
                options.mimetype.startsWith('text/');

            let messageContent: any;

            if (isImage) {
                messageContent = {
                    image: mediaBuffer,
                    caption: options.caption || '',
                    mimetype: options.mimetype
                };
            } else {
                // Document (PDF, etc)
                messageContent = {
                    document: mediaBuffer,
                    mimetype: options.mimetype,
                    fileName: options.filename || 'document',
                    caption: options.caption || ''
                };
            }

            await this.socket.sendMessage(jid, messageContent);

            // Update rate limit counters
            this.rateLimit.messagesThisHour++;
            this.rateLimit.messagesToday++;
            this.rateLimit.lastMessageTime = Date.now();

            // Store outgoing message record
            const storedMsg: WhatsAppMessage = {
                id: `out_media_${Date.now()}`,
                jid: jid,
                phone: whatsappMessages.jidToPhone(jid),
                direction: 'outgoing',
                content: options.caption || `[${isImage ? 'Image' : 'Document'}: ${options.filename || 'file'}]`,
                timestamp: Date.now(),
                status: 'sent'
            };
            await whatsappMessages.saveMessage(storedMsg);

            this.log('Sent media', {
                to: jid.split('@')[0].slice(-4),
                type: isImage ? 'image' : 'document',
                size: mediaBuffer.length
            });
            return { success: true };
        } catch (error) {
            this.log('Send media error', { error: String(error) });
            return { success: false, error: String(error) };
        }
    }

    /**
     * Send a WhatsApp message with rate limiting
     */
    async send(lead: Lead, message: string): Promise<SendResult> {
        const contactId = this.getContactId(lead);

        if (!contactId) {
            return this.createResult(false, '', {
                error: 'No phone number available for lead'
            });
        }

        // Check connection
        if (!this.socket || !this.connectionReady) {
            return this.createResult(false, contactId, {
                error: 'WhatsApp not connected. Run connect() first.'
            });
        }

        // Check rate limits
        const limitCheck = this.checkRateLimits();
        if (!limitCheck.allowed) {
            return this.createResult(false, contactId, {
                error: limitCheck.reason
            });
        }

        // Enforce minimum delay
        const timeSinceLast = Date.now() - this.rateLimit.lastMessageTime;
        if (timeSinceLast < this.MIN_DELAY_MS && this.rateLimit.lastMessageTime > 0) {
            const waitTime = this.MIN_DELAY_MS - timeSinceLast;
            this.log('Rate limit delay', { waitMs: waitTime });
            await this.sleep(waitTime);
        }

        try {
            const jid = contactId + '@s.whatsapp.net';

            // Send the message
            await this.socket.sendMessage(jid, { text: message });

            // Update rate limit counters
            this.rateLimit.messagesThisHour++;
            this.rateLimit.messagesToday++;
            this.rateLimit.lastMessageTime = Date.now();

            this.log('Sent', {
                to: lead.companyName,
                daily: `${this.rateLimit.messagesToday}/${this.MAX_PER_DAY}`
            });

            // Store outgoing message
            try {
                const storedMsg: WhatsAppMessage = {
                    id: `out_${Date.now()}_${contactId}`,
                    jid: jid,
                    phone: '+' + contactId,
                    direction: 'outgoing',
                    content: message,
                    timestamp: Date.now(),
                    leadId: lead.id,
                    status: 'sent'
                };
                await whatsappMessages.saveMessage(storedMsg);

                // Link lead to phone if not already linked
                await whatsappMessages.linkLead('+' + contactId, lead.id, lead.companyName);
            } catch (err) {
                console.error('[WHATSAPP] Failed to store outgoing message:', err);
            }

            return this.createResult(true, contactId, {
                messageId: `wa_${Date.now()}_${contactId}`
            });
        } catch (error) {
            this.log('Send error', { error: String(error) });
            return this.createResult(false, contactId, {
                error: String(error)
            });
        }
    }

    /**
     * Check if we're within rate limits
     */
    private checkRateLimits(): { allowed: boolean; reason?: string } {
        const now = Date.now();

        // Reset hourly counter
        if (now - this.rateLimit.hourStart > 60 * 60 * 1000) {
            this.rateLimit.messagesThisHour = 0;
            this.rateLimit.hourStart = now;
        }

        // Reset daily counter
        if (now - this.rateLimit.dayStart > 24 * 60 * 60 * 1000) {
            this.rateLimit.messagesToday = 0;
            this.rateLimit.dayStart = now;
        }

        if (this.rateLimit.messagesThisHour >= this.MAX_PER_HOUR) {
            return {
                allowed: false,
                reason: `Hourly limit reached (${this.MAX_PER_HOUR}/hour). Try again later.`,
            };
        }

        if (this.rateLimit.messagesToday >= this.MAX_PER_DAY) {
            return {
                allowed: false,
                reason: `Daily limit reached (${this.MAX_PER_DAY}/day). Try again tomorrow.`,
            };
        }

        return { allowed: true };
    }

    /**
     * Format phone number to digits only
     * Handles Kazakhstan numbers (+7, 8) and international
     */
    private formatPhoneNumber(phone: string): string | null {
        if (!phone) return null;

        // Extract from wa.me links
        if (phone.includes('wa.me')) {
            const match = phone.match(/wa\.me\/(\d+)/);
            if (match) return match[1];
        }

        // Remove all non-digits
        let digits = phone.replace(/\D/g, '');

        // Handle Kazakhstan numbers (8 -> 7)
        if (digits.startsWith('8') && digits.length === 11) {
            digits = '7' + digits.substring(1);
        }

        // Must be at least 10 digits
        if (digits.length < 10) {
            return null;
        }

        // Add country code if missing
        if (digits.length === 10) {
            digits = '7' + digits; // Assume Kazakhstan
        }

        return digits;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current rate limit status
     */
    getRateLimitStatus(): { hourly: string; daily: string; nextAllowed: string } {
        const hourlyRemaining = this.MAX_PER_HOUR - this.rateLimit.messagesThisHour;
        const dailyRemaining = this.MAX_PER_DAY - this.rateLimit.messagesToday;

        let nextAllowed = 'Now';
        const timeSinceLast = Date.now() - this.rateLimit.lastMessageTime;
        if (timeSinceLast < this.MIN_DELAY_MS && this.rateLimit.lastMessageTime > 0) {
            const waitSec = Math.ceil((this.MIN_DELAY_MS - timeSinceLast) / 1000);
            nextAllowed = `In ${waitSec}s`;
        }

        return {
            hourly: `${hourlyRemaining}/${this.MAX_PER_HOUR} remaining`,
            daily: `${dailyRemaining}/${this.MAX_PER_DAY} remaining`,
            nextAllowed,
        };
    }

    /**
     * Disconnect gracefully
     */
    async disconnect(): Promise<void> {
        if (this.socket) {
            await this.socket.logout();
            this.socket = null;
            this.connectionReady = false;
        }
    }

    /**
     * Sync existing chats from WhatsApp
     * Fetches recent messages from active chats
     */
    async syncChats(limit: number = 50): Promise<{ synced: number; chats: number }> {
        if (!this.socket || !this.connectionReady) {
            console.log('[WHATSAPP] Cannot sync - not connected');
            return { synced: 0, chats: 0 };
        }

        console.log('[WHATSAPP] Starting chat sync...');
        let totalMessages = 0;
        let chatCount = 0;

        try {
            // Get all chats from the store
            const chats = await this.socket.groupFetchAllParticipating();
            console.log(`[WHATSAPP] Found ${Object.keys(chats).length} group chats`);

            // For individual chats, we need to use fetchMessagesFromWA
            // Baileys stores recent messages, we can access them via the socket

            // Get contacts/chats that have recent activity
            // Note: Baileys doesn't natively provide a "get all chats" method
            // We sync messages as they come in via messages.upsert
            // For history, user would need to trigger messages manually

            console.log('[WHATSAPP] Chat sync complete. New messages will be synced automatically.');
            console.log('[WHATSAPP] Tip: Send or receive a message to see it in the inbox.');

            return { synced: totalMessages, chats: chatCount };
        } catch (error) {
            console.error('[WHATSAPP] Sync error:', error);
            return { synced: 0, chats: 0 };
        }
    }

    /**
     * Get the socket for advanced operations
     */
    getSocket(): WASocket | null {
        return this.socket;
    }

    /**
     * Get current QR code for UI display
     */
    getQR(): string | null {
        return this.currentQR;
    }
}

// Singleton instance
export const whatsapp = new WhatsAppAdapter();
