/**
 * Telegram Channel Adapter
 * Uses grammY for Telegram bot integration
 */

import { BaseChannelAdapter, type SendResult } from './base.js';
import type { Lead } from '../types.js';

// Use grammY for bot API
let Bot: any;
let bot: any;

export class TelegramAdapter extends BaseChannelAdapter {
    readonly name = 'telegram' as const;
    private isConnected = false;
    private botUsername: string | null = null;

    constructor() {
        super();
    }

    /**
     * Initialize the Telegram bot
     */
    async connect(): Promise<boolean> {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            console.log('[TELEGRAM] No TELEGRAM_BOT_TOKEN set');
            return false;
        }

        try {
            // Dynamic import to avoid issues if grammY not installed
            const grammy = await import('grammy');
            Bot = grammy.Bot;

            bot = new Bot(token);

            // Get bot info
            const me = await bot.api.getMe();
            this.botUsername = me.username;
            this.isConnected = true;

            console.log(`[TELEGRAM] Connected as @${this.botUsername}`);

            // Set up message handler for incoming messages
            bot.on('message:text', async (ctx: any) => {
                const chatId = ctx.chat.id.toString();
                const text = ctx.message.text;
                const username = ctx.from?.username;

                console.log(`[TELEGRAM] Received from ${username || chatId}: ${text.slice(0, 50)}...`);

                // Handle /start command with lead ID
                if (text.startsWith('/start ')) {
                    const startParam = text.slice(7);
                    try {
                        const leadId = Buffer.from(startParam, 'base64url').toString();
                        console.log(`[TELEGRAM] Lead ${leadId} started conversation`);

                        // Store chatId for future messages
                        this.storeChatId(leadId, chatId);
                    } catch (e) {
                        // Not a valid lead ID
                    }
                }

                // Emit event for response handling
                this.onMessageReceived?.(chatId, text);
            });

            // Start polling (non-blocking)
            bot.start({ drop_pending_updates: true });

            return true;
        } catch (error) {
            console.error('[TELEGRAM] Connection failed:', error);
            return false;
        }
    }

    /**
     * Callback for incoming messages
     */
    onMessageReceived?: (chatId: string, text: string) => void;

    /**
     * Chat ID storage (leadId -> chatId mapping)
     */
    private chatIdMap = new Map<string, string>();

    storeChatId(leadId: string, chatId: string) {
        this.chatIdMap.set(leadId, chatId);
    }

    getChatId(leadId: string): string | null {
        return this.chatIdMap.get(leadId) || null;
    }

    canReach(lead: Lead): boolean {
        // Can reach if we have their Telegram handle OR they've started a conversation
        return !!lead.telegramHandle || this.chatIdMap.has(lead.id);
    }

    getContactId(lead: Lead): string | null {
        // First check if we have a chat ID from a previous conversation
        const chatId = this.getChatId(lead.id);
        if (chatId) return chatId;

        // Otherwise use handle
        if (!lead.telegramHandle) return null;
        return lead.telegramHandle.replace(/^@/, '');
    }

    async send(lead: Lead, message: string): Promise<SendResult> {
        if (!bot || !this.isConnected) {
            return this.createResult(false, '', { error: 'Telegram bot not connected' });
        }

        // Try to get chat ID
        const chatId = this.getChatId(lead.id);

        if (!chatId) {
            // We can't send to users who haven't started a conversation
            // Return a link they can click
            const link = this.generateStartLink(lead.id);
            return this.createResult(false, '', {
                error: `Lead hasn't started conversation. Share: ${link}`
            });
        }

        try {
            const result = await bot.api.sendMessage(chatId, message, {
                parse_mode: 'HTML'
            });

            this.log('Message sent', { messageId: result.message_id, to: chatId });

            return this.createResult(true, result.message_id.toString());
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.log('Send failed', { error: errorMsg });
            return this.createResult(false, '', { error: errorMsg });
        }
    }

    /**
     * Send message to a specific chat ID (for broadcasts)
     */
    async sendToChatId(chatId: string, message: string): Promise<SendResult> {
        if (!bot || !this.isConnected) {
            return this.createResult(false, '', { error: 'Telegram bot not connected' });
        }

        try {
            const result = await bot.api.sendMessage(chatId, message, {
                parse_mode: 'HTML'
            });
            return this.createResult(true, result.message_id.toString());
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return this.createResult(false, '', { error: errorMsg });
        }
    }

    /**
     * Generate a deep link for user to start conversation
     */
    generateStartLink(leadId: string): string | null {
        const username = this.botUsername || process.env.TELEGRAM_BOT_USERNAME;
        if (!username) return null;

        const startParam = Buffer.from(leadId).toString('base64url');
        return `https://t.me/${username}?start=${startParam}`;
    }

    async isReady(): Promise<boolean> {
        return this.isConnected;
    }

    getBotUsername(): string | null {
        return this.botUsername;
    }
}

// Singleton
export const telegram = new TelegramAdapter();
