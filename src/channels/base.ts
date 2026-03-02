/**
 * Channel Interface
 * Base interface for all messaging channels
 */

import type { Channel, Lead } from '../types.js';

export interface SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
    channel: Channel;
    recipient: string;
    timestamp: Date;
}

export interface ChannelAdapter {
    readonly name: Channel;

    /**
     * Check if this channel can reach the lead
     */
    canReach(lead: Lead): boolean;

    /**
     * Get the contact identifier for this channel
     */
    getContactId(lead: Lead): string | null;

    /**
     * Send a message via this channel
     */
    send(lead: Lead, message: string): Promise<SendResult>;

    /**
     * Check if channel is configured and ready
     */
    isReady(): Promise<boolean>;
}

/**
 * Base adapter with common functionality
 */
export abstract class BaseChannelAdapter implements ChannelAdapter {
    abstract readonly name: Channel;

    abstract canReach(lead: Lead): boolean;
    abstract getContactId(lead: Lead): string | null;
    abstract send(lead: Lead, message: string): Promise<SendResult>;
    abstract isReady(): Promise<boolean>;

    protected createResult(
        success: boolean,
        recipient: string,
        options?: { messageId?: string; error?: string }
    ): SendResult {
        return {
            success,
            messageId: options?.messageId,
            error: options?.error,
            channel: this.name,
            recipient,
            timestamp: new Date(),
        };
    }

    protected log(action: string, details?: Record<string, unknown>): void {
        console.log(`[${this.name.toUpperCase()}] ${action}`, details || '');
    }
}
