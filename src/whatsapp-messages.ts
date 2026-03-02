/**
 * WhatsApp Message Storage
 * Stores and retrieves WhatsApp messages in Redis
 */

import { createClient, RedisClientType } from 'redis';

// Message structure
export interface WhatsAppMessage {
    id: string;
    jid: string;           // WhatsApp JID (phone@s.whatsapp.net)
    phone: string;         // Normalized phone number
    direction: 'incoming' | 'outgoing';
    content: string;
    timestamp: number;
    leadId?: string;       // Linked lead ID
    status?: 'sent' | 'delivered' | 'read' | 'failed';
    metadata?: Record<string, any>;
}

// Conversation summary
export interface Conversation {
    jid: string;
    phone: string;
    leadId?: string;
    leadName?: string;
    lastMessage: string;
    lastMessageTime: number;
    unreadCount: number;
    messageCount: number;
}

class WhatsAppMessages {
    private redis: RedisClientType | null = null;
    private connected = false;

    // Redis key prefixes
    private readonly MESSAGES_KEY = 'whatsapp:messages';      // sorted set per JID
    private readonly CONVERSATIONS_KEY = 'whatsapp:conversations';  // hash of JIDs
    private readonly LEAD_MAP_KEY = 'whatsapp:lead_map';      // phone -> leadId

    /**
     * Connect to Redis
     */
    async connect(): Promise<void> {
        if (this.connected) return;

        const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
        this.redis = createClient({ url: redisUrl });

        this.redis.on('error', (err) => console.error('[WHATSAPP-MSG] Redis error:', err));

        await this.redis.connect();
        this.connected = true;
        console.log('[WHATSAPP-MSG] Connected to Redis');
    }

    /**
     * Ensure connected to Redis
     */
    private async ensureConnected(): Promise<void> {
        if (!this.connected || !this.redis) {
            await this.connect();
        }
    }

    /**
     * Save a message
     */
    async saveMessage(message: WhatsAppMessage): Promise<void> {
        await this.ensureConnected();
        if (!this.redis) return;

        // Store message in sorted set (by timestamp)
        const key = `${this.MESSAGES_KEY}:${message.jid}`;
        await this.redis.zAdd(key, {
            score: message.timestamp,
            value: JSON.stringify(message)
        });

        // Update conversation summary
        await this.updateConversation(message);

        // Trim old messages (keep last 1000 per conversation)
        await this.redis.zRemRangeByRank(key, 0, -1001);
    }

    /**
     * Update conversation summary
     */
    private async updateConversation(message: WhatsAppMessage): Promise<void> {
        if (!this.redis) return;

        const existing = await this.redis.hGet(this.CONVERSATIONS_KEY, message.jid);
        let conversation: Conversation;

        if (existing) {
            conversation = JSON.parse(existing);
            conversation.lastMessage = message.content.substring(0, 100);
            conversation.lastMessageTime = message.timestamp;
            conversation.messageCount++;
            if (message.direction === 'incoming') {
                conversation.unreadCount++;
            }
        } else {
            conversation = {
                jid: message.jid,
                phone: message.phone,
                leadId: message.leadId,
                lastMessage: message.content.substring(0, 100),
                lastMessageTime: message.timestamp,
                unreadCount: message.direction === 'incoming' ? 1 : 0,
                messageCount: 1
            };
        }

        await this.redis.hSet(this.CONVERSATIONS_KEY, message.jid, JSON.stringify(conversation));
    }

    /**
     * Get messages for a JID
     */
    async getMessages(jid: string, limit = 50): Promise<WhatsAppMessage[]> {
        await this.ensureConnected();
        if (!this.redis) return [];

        const key = `${this.MESSAGES_KEY}:${jid}`;
        const raw = await this.redis.zRange(key, -limit, -1);

        return raw.map(r => JSON.parse(r) as WhatsAppMessage);
    }

    /**
     * Get all conversations sorted by last message time
     */
    async getConversations(): Promise<Conversation[]> {
        await this.ensureConnected();
        if (!this.redis) return [];

        const all = await this.redis.hGetAll(this.CONVERSATIONS_KEY);
        const conversations = Object.values(all)
            .map(v => JSON.parse(v) as Conversation)
            .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

        return conversations;
    }

    /**
     * Mark conversation as read
     */
    async markAsRead(jid: string): Promise<void> {
        await this.ensureConnected();
        if (!this.redis) return;

        const existing = await this.redis.hGet(this.CONVERSATIONS_KEY, jid);
        if (existing) {
            const conversation = JSON.parse(existing) as Conversation;
            conversation.unreadCount = 0;
            await this.redis.hSet(this.CONVERSATIONS_KEY, jid, JSON.stringify(conversation));
        }
    }

    /**
     * Link a phone number to a lead
     */
    async linkLead(phone: string, leadId: string, leadName?: string): Promise<void> {
        await this.ensureConnected();
        if (!this.redis) return;

        await this.redis.hSet(this.LEAD_MAP_KEY, phone, JSON.stringify({ leadId, leadName }));

        // Update any existing conversations with this phone
        const jid = this.phoneToJid(phone);
        const existing = await this.redis.hGet(this.CONVERSATIONS_KEY, jid);
        if (existing) {
            const conversation = JSON.parse(existing) as Conversation;
            conversation.leadId = leadId;
            conversation.leadName = leadName;
            await this.redis.hSet(this.CONVERSATIONS_KEY, jid, JSON.stringify(conversation));
        }
    }

    /**
     * Get lead info for a phone number
     */
    async getLeadByPhone(phone: string): Promise<{ leadId: string; leadName?: string } | null> {
        await this.ensureConnected();
        if (!this.redis) return null;

        const raw = await this.redis.hGet(this.LEAD_MAP_KEY, phone);
        if (raw) {
            return JSON.parse(raw);
        }
        return null;
    }

    /**
     * Get messages for a lead
     */
    async getLeadMessages(leadId: string): Promise<WhatsAppMessage[]> {
        await this.ensureConnected();
        if (!this.redis) return [];

        // Find all phones linked to this lead
        const leadMap = await this.redis.hGetAll(this.LEAD_MAP_KEY);
        const phones: string[] = [];

        for (const [phone, value] of Object.entries(leadMap)) {
            const parsed = JSON.parse(value);
            if (parsed.leadId === leadId) {
                phones.push(phone);
            }
        }

        // Get messages for all linked phones
        const allMessages: WhatsAppMessage[] = [];
        for (const phone of phones) {
            const jid = this.phoneToJid(phone);
            const messages = await this.getMessages(jid, 100);
            allMessages.push(...messages);
        }

        // Sort by timestamp
        return allMessages.sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Convert phone to WhatsApp JID
     */
    phoneToJid(phone: string): string {
        const clean = phone.replace(/\D/g, '');
        return `${clean}@s.whatsapp.net`;
    }

    /**
     * Extract phone from JID and format nicely
     */
    jidToPhone(jid: string): string {
        // Remove all WhatsApp suffixes
        let phone = jid
            .replace('@s.whatsapp.net', '')
            .replace('@c.us', '')
            .replace('@lid', '')
            .replace('@g.us', ''); // groups

        // Remove any non-digit characters
        phone = phone.replace(/\D/g, '');

        // Format with + prefix
        if (phone.length > 0) {
            return '+' + phone;
        }
        return phone;
    }

    /**
     * Get recent messages across all conversations
     */
    async getRecentMessages(limit = 20): Promise<WhatsAppMessage[]> {
        const conversations = await this.getConversations();
        const allMessages: WhatsAppMessage[] = [];

        for (const conv of conversations.slice(0, 10)) {
            const messages = await this.getMessages(conv.jid, 5);
            allMessages.push(...messages);
        }

        return allMessages
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get total unread count
     */
    async getUnreadCount(): Promise<number> {
        const conversations = await this.getConversations();
        return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
    }
}

// Singleton export
export const whatsappMessages = new WhatsAppMessages();
