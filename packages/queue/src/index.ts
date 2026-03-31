import { Queue, ConnectionOptions } from 'bullmq';
import { env } from '@leadiya/config';

// ─── Shared Connection ───────────────────────────────────────────────────────

export const connection: ConnectionOptions = {
    url: env.REDIS_URL,
    // Add additional settings like TLS if needed later
};

// ─── Queue Definitions ───────────────────────────────────────────────────────

export enum QueueName {
    DISCOVERY = 'discovery',
    ENRICHMENT = 'enrichment',
    TENDER_MONITOR = 'tender_monitor',
    WATCHDOG = 'watchdog',
    PROMOTION = 'promotion',
    /** Baileys outbound WhatsApp sends (worker concurrency must stay 1) */
    WHATSAPP_OUTREACH = 'whatsapp_outreach',
    EMAIL_OUTREACH = 'email_outreach',
}

// ─── Typed Job Data ─────────────────────────────────────────────────────────

export interface DiscoveryJobData {
    city: string
    category: string
    scraper?: string
    tenantId?: string
    scraperName?: string
    params?: Record<string, unknown>
}

export interface EnrichmentJobData {
    leadId: string;
    tenantId: string;
}

export interface WhatsAppOutreachJobData {
    /** When omitted, outbound log row has no CRM lead (e.g. inbox quick-send). */
    leadId?: string;
    /** Normalized digits (e.g. 7XXXXXXXXXX) for @s.whatsapp.net */
    phoneDigits: string;
    body: string;
    sequenceKey?: string;
    stepIndex?: number;
    /** Tenant whose WhatsApp session should be used for sending. */
    tenantId?: string;
    /**
     * Operator pings (FOUNDER_WHATSAPP). Logged with status internal_alert — excluded from
     * auto-reply caps and hidden from default CRM thread views.
     */
    outreachLogStatus?: 'internal_alert';
}

export interface EmailOutreachJobData {
    leadId: string;
    to: string;
    subject: string;
    body: string;
    sequenceKey?: string;
    stepIndex?: number;
    tenantId?: string;
}

// ─── Queue Manager ──────────────────────────────────────────────────────────

export class QueueManager {
    private static instances: Map<string, Queue> = new Map();

    static getQueue<T = any>(name: QueueName): Queue<T> {
        if (!this.instances.has(name)) {
            const queue = new Queue(name, {
                connection,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: true,
                    removeOnFail: false,
                },
            });
            this.instances.set(name, queue);
        }
        return this.instances.get(name) as Queue<T>;
    }

    static async closeAll(): Promise<void> {
        for (const queue of this.instances.values()) {
            await queue.close();
        }
        this.instances.clear();
    }
}

// ─── Accessors ──────────────────────────────────────────────────────────────

export const discoveryQueue = QueueManager.getQueue<DiscoveryJobData>(QueueName.DISCOVERY);
export const enrichmentQueue = QueueManager.getQueue<EnrichmentJobData>(QueueName.ENRICHMENT);
export const whatsappOutreachQueue = QueueManager.getQueue<WhatsAppOutreachJobData>(
    QueueName.WHATSAPP_OUTREACH
);
export const emailOutreachQueue = QueueManager.getQueue<EmailOutreachJobData>(
    QueueName.EMAIL_OUTREACH
);
