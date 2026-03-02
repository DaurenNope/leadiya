/**
 * Messenger - Unified Channel Manager
 * Routes messages to the appropriate channel based on config and availability
 */

import type { Lead, Channel } from '../types.js';
import type { ChannelAdapter, SendResult } from './base.js';
import { whatsapp, WhatsAppAdapter } from './whatsapp.js';
import { email, EmailAdapter } from './email.js';
import { telegram, TelegramAdapter } from './telegram.js';
import { config } from '../config.js';

export interface MessengerResult extends SendResult {
    attemptedChannels: Channel[];
    fallbackUsed: boolean;
}

export class Messenger {
    private adapters: Map<Channel, ChannelAdapter> = new Map();
    private channelPriority: Channel[];

    constructor() {
        // Register adapters
        this.adapters.set('whatsapp', whatsapp);
        this.adapters.set('email', email);
        this.adapters.set('telegram', telegram);

        // Load channel priority from config
        const business = config.loadBusiness();
        this.channelPriority = [
            business.channels.primary,
            business.channels.fallback,
            business.channels.tertiary,
        ].filter(Boolean) as Channel[];
    }

    /**
     * Get adapter for a specific channel
     */
    getAdapter(channel: Channel): ChannelAdapter | undefined {
        return this.adapters.get(channel);
    }

    /**
     * Check which channels can reach this lead
     */
    getAvailableChannels(lead: Lead): Channel[] {
        const available: Channel[] = [];

        for (const [channel, adapter] of this.adapters) {
            if (adapter.canReach(lead)) {
                available.push(channel);
            }
        }

        return available;
    }

    /**
     * Get the best channel for a lead based on priority and availability
     */
    getBestChannel(lead: Lead): Channel | null {
        for (const channel of this.channelPriority) {
            const adapter = this.adapters.get(channel);
            if (adapter?.canReach(lead)) {
                return channel;
            }
        }
        return null;
    }

    /**
     * Send message via specific channel
     */
    async sendVia(channel: Channel, lead: Lead, message: string): Promise<SendResult> {
        const adapter = this.adapters.get(channel);

        if (!adapter) {
            return {
                success: false,
                error: `Unknown channel: ${channel}`,
                channel,
                recipient: '',
                timestamp: new Date(),
            };
        }

        if (!adapter.canReach(lead)) {
            return {
                success: false,
                error: `Cannot reach lead via ${channel}`,
                channel,
                recipient: '',
                timestamp: new Date(),
            };
        }

        return adapter.send(lead, message);
    }

    /**
     * Send message with automatic channel selection and fallback
     */
    async send(lead: Lead, message: string, preferredChannel?: Channel): Promise<MessengerResult> {
        const attemptedChannels: Channel[] = [];

        // Build channel order
        const channelsToTry: Channel[] = [];

        if (preferredChannel) {
            channelsToTry.push(preferredChannel);
        }

        for (const channel of this.channelPriority) {
            if (!channelsToTry.includes(channel)) {
                channelsToTry.push(channel);
            }
        }

        // Try each channel in order
        for (const channel of channelsToTry) {
            const adapter = this.adapters.get(channel);

            if (!adapter?.canReach(lead)) {
                continue;
            }

            attemptedChannels.push(channel);

            const result = await adapter.send(lead, message);

            if (result.success) {
                return {
                    ...result,
                    attemptedChannels,
                    fallbackUsed: attemptedChannels.length > 1,
                };
            }

            console.log(`[MESSENGER] ${channel} failed, trying next...`);
        }

        // All channels failed
        return {
            success: false,
            error: 'All channels failed',
            channel: attemptedChannels[0] || 'whatsapp',
            recipient: '',
            timestamp: new Date(),
            attemptedChannels,
            fallbackUsed: attemptedChannels.length > 1,
        };
    }

    /**
     * Check status of all channels
     */
    async getChannelStatus(): Promise<Record<Channel, { ready: boolean; canReach?: string[] }>> {
        const status: Record<string, { ready: boolean }> = {};

        for (const [channel, adapter] of this.adapters) {
            status[channel] = {
                ready: await adapter.isReady(),
            };
        }

        return status as Record<Channel, { ready: boolean }>;
    }

    /**
     * Send to multiple leads (batch)
     */
    async sendBatch(
        leads: Lead[],
        messageGenerator: (lead: Lead) => string,
        options?: { rateLimit?: number; channel?: Channel }
    ): Promise<{ successful: number; failed: number; results: MessengerResult[] }> {
        const results: MessengerResult[] = [];
        let successful = 0;
        let failed = 0;

        const rateLimit = options?.rateLimit || 1000; // Default 1 second between messages

        for (const lead of leads) {
            const message = messageGenerator(lead);
            const result = await this.send(lead, message, options?.channel);

            results.push(result);

            if (result.success) {
                successful++;
            } else {
                failed++;
            }

            // Rate limiting
            if (leads.indexOf(lead) < leads.length - 1) {
                await new Promise(resolve => setTimeout(resolve, rateLimit));
            }
        }

        return { successful, failed, results };
    }
}

// Singleton
export const messenger = new Messenger();

// Re-export individual adapters
export { whatsapp, email, telegram };
export type { ChannelAdapter, SendResult } from './base.js';
