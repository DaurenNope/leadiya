/**
 * Discovery Module
 * Finds and imports leads from various sources
 */

import type { Lead, LeadSource } from './types.js';
import { leads, LeadRepository } from './leads.js';
import { qualifier, Qualifier } from './qualifier.js';
import { config, ConfigLoader } from './config.js';
import { LinkedInScraper } from './linkedin.js';
import { TelegramGroupScraper } from './telegram-scraper.js';
import { HeadHunterScraper } from './headhunter-scraper.js';
import { VCRuScraper } from './vcru-scraper.js';
import { TwoGISScraper } from './2gis-scraper.js';
import { KompraScraper } from './kompra-scraper.js';
import { RusprofileScraper } from './rusprofile-scraper.js';
import { YandexMapsScraper } from './yandex-maps-scraper.js';
import { ZoonScraper } from './zoon-scraper.js';

export interface DiscoveredLead {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName: string;
    jobTitle?: string;
    industry?: string;
    linkedinUrl?: string;
    twitterHandle?: string;
    telegramHandle?: string;
    whatsappNumber?: string;
    signals?: string[];
    rawData?: Record<string, unknown>;
}

export interface DiscoveryAdapter {
    readonly name: string;
    readonly source: LeadSource;

    /**
     * Discover leads from this source
     */
    discover(): Promise<DiscoveredLead[]>;

    /**
     * Check if adapter is configured and ready
     */
    isReady(): Promise<boolean>;
}

/**
 * Webhook Receiver
 * Receives leads from external sources via webhooks
 */
export class WebhookReceiver implements DiscoveryAdapter {
    readonly name = 'webhook';
    readonly source: LeadSource = 'inbound';
    private webhookSecret: string;
    private pendingLeads: DiscoveredLead[] = [];

    constructor(secret?: string) {
        this.webhookSecret = secret || process.env.WEBHOOK_SECRET || '';
    }

    /**
     * Process incoming webhook payload
     */
    processPayload(payload: Record<string, unknown>, signature?: string): DiscoveredLead | null {
        // Verify signature if secret is configured
        if (this.webhookSecret && !this.verifySignature(payload, signature)) {
            console.error('[WEBHOOK] Invalid signature');
            return null;
        }

        // Transform payload to lead data
        const lead = this.transformPayload(payload);
        if (lead) {
            this.pendingLeads.push(lead);
        }
        return lead;
    }

    private verifySignature(payload: Record<string, unknown>, signature?: string): boolean {
        // In production, implement HMAC verification
        if (!signature) return false;
        // Simplified check - in production use crypto.createHmac
        return signature.startsWith('sha256=');
    }

    private transformPayload(payload: Record<string, unknown>): DiscoveredLead | null {
        // Support common CRM/form formats
        const data = payload.data as Record<string, unknown> || payload;

        // Try to extract lead info from various formats
        const firstName = (data.first_name || data.firstName || data.name?.toString().split(' ')[0] || '') as string;
        const lastName = (data.last_name || data.lastName || data.name?.toString().split(' ').slice(1).join(' ') || '') as string;

        if (!firstName) {
            console.error('[WEBHOOK] Missing required field: firstName');
            return null;
        }

        return {
            firstName,
            lastName,
            email: (data.email || '') as string,
            phone: (data.phone || data.phoneNumber || '') as string,
            companyName: (data.company || data.companyName || data.organization || 'Unknown') as string,
            jobTitle: (data.title || data.jobTitle || data.role || '') as string,
            industry: (data.industry || '') as string,
            linkedinUrl: (data.linkedin || data.linkedinUrl || '') as string,
            whatsappNumber: (data.whatsapp || data.whatsappNumber || data.phone || '') as string,
            telegramHandle: (data.telegram || data.telegramHandle || '') as string,
            signals: (data.signals || data.tags || []) as string[],
            rawData: data as Record<string, unknown>,
        };
    }

    async discover(): Promise<DiscoveredLead[]> {
        const leads = [...this.pendingLeads];
        this.pendingLeads = []; // Clear pending
        return leads;
    }

    async isReady(): Promise<boolean> {
        return true;
    }
}

/**
 * CSV/JSON Importer
 * Imports leads from file uploads
 */
export class FileImporter implements DiscoveryAdapter {
    readonly name = 'file';
    readonly source: LeadSource = 'import';
    private pendingLeads: DiscoveredLead[] = [];

    /**
     * Parse CSV string
     */
    parseCSV(csv: string): DiscoveredLead[] {
        const lines = csv.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const leads: DiscoveredLead[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            const record: Record<string, string> = {};

            headers.forEach((h, idx) => {
                record[h] = values[idx] || '';
            });

            const lead = this.transformRecord(record);
            if (lead) leads.push(lead);
        }

        this.pendingLeads.push(...leads);
        return leads;
    }

    /**
     * Parse JSON array
     */
    parseJSON(json: Record<string, unknown>[]): DiscoveredLead[] {
        const leads = json
            .map(record => this.transformRecord(record))
            .filter(Boolean) as DiscoveredLead[];

        this.pendingLeads.push(...leads);
        return leads;
    }

    private transformRecord(record: Record<string, unknown>): DiscoveredLead | null {
        const firstName = (record.first_name || record.firstname || record.firstName || record.name?.toString().split(' ')[0] || '') as string;

        if (!firstName) return null;

        return {
            firstName,
            lastName: (record.last_name || record.lastname || record.lastName || '') as string,
            email: (record.email || '') as string,
            phone: (record.phone || record.phoneNumber || '') as string,
            companyName: (record.company || record.companyName || 'Unknown') as string,
            jobTitle: (record.title || record.jobTitle || record.role || '') as string,
            industry: (record.industry || '') as string,
            linkedinUrl: (record.linkedin || '') as string,
            whatsappNumber: (record.whatsapp || record.phone || '') as string,
            telegramHandle: (record.telegram || '') as string,
        };
    }

    async discover(): Promise<DiscoveredLead[]> {
        const leads = [...this.pendingLeads];
        this.pendingLeads = [];
        return leads;
    }

    async isReady(): Promise<boolean> {
        return true;
    }
}
// LinkedIn scraper imported from ./linkedin.ts

/**
 * Discovery Manager
 * Coordinates all discovery adapters
 */
export class DiscoveryManager {
    private adapters: Map<string, DiscoveryAdapter> = new Map();
    private leadRepo: LeadRepository;
    private qualifierEngine: Qualifier;

    constructor(leadRepo?: LeadRepository, qualifierEngine?: Qualifier) {
        this.leadRepo = leadRepo || leads;
        this.qualifierEngine = qualifierEngine || qualifier;

        // Register built-in adapters
        this.register(new WebhookReceiver());
        this.register(new FileImporter());

        // Global scrapers
        this.register(new LinkedInScraper());

        // CIS-specific scrapers
        this.register(new TelegramGroupScraper());
        this.register(new HeadHunterScraper());
        this.register(new VCRuScraper());

        // B2B company directories
        this.register(new TwoGISScraper());
        this.register(new KompraScraper());
        this.register(new RusprofileScraper());
        this.register(new YandexMapsScraper());
        this.register(new ZoonScraper());
    }

    register(adapter: DiscoveryAdapter): void {
        this.adapters.set(adapter.name, adapter);
        console.log(`[DISCOVERY] Registered adapter: ${adapter.name}`);
    }

    getAdapter<T extends DiscoveryAdapter>(name: string): T | undefined {
        return this.adapters.get(name) as T;
    }

    /**
     * Run discovery across all adapters
     */
    async runDiscovery(): Promise<{
        discovered: number;
        imported: number;
        qualified: number;
        duplicates: number;
        errors: string[];
    }> {
        const results = {
            discovered: 0,
            imported: 0,
            qualified: 0,
            duplicates: 0,
            errors: [] as string[],
        };

        for (const [name, adapter] of this.adapters) {
            if (!(await adapter.isReady())) {
                console.log(`[DISCOVERY] Skipping ${name} - not ready`);
                continue;
            }

            try {
                const discovered = await adapter.discover();
                results.discovered += discovered.length;

                for (const leadData of discovered) {
                    const importResult = await this.importLead(leadData, adapter.source);

                    if (importResult.duplicate) {
                        results.duplicates++;
                    } else if (importResult.lead) {
                        results.imported++;
                        if (importResult.qualified) {
                            results.qualified++;
                        }
                    }
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                results.errors.push(`${name}: ${msg}`);
            }
        }

        console.log(`[DISCOVERY] Complete:`, results);
        return results;
    }

    /**
     * Import a single discovered lead
     */
    async importLead(data: DiscoveredLead, source: LeadSource): Promise<{
        lead: Lead | null;
        duplicate: boolean;
        qualified: boolean;
    }> {
        // Check for duplicates
        if (data.email && await this.leadRepo.existsByEmail(data.email)) {
            return { lead: null, duplicate: true, qualified: false };
        }
        if (data.phone && await this.leadRepo.existsByPhone(data.phone)) {
            return { lead: null, duplicate: true, qualified: false };
        }

        // Create lead
        const lead = await this.leadRepo.create({
            ...data,
            source,
            state: 'discovered',
        });

        // Qualify
        const qualResult = this.qualifierEngine.qualify(lead);

        // Update with qualification data
        // Generate signal summary from matched signals
        const signalSummary = this.qualifierEngine.generateSignalSummary(qualResult.matchedSignals);

        await this.leadRepo.update(lead.id, {
            score: qualResult.score,
            state: qualResult.qualified ? 'qualified' : 'disqualified',
            signalSummary,
        });

        return {
            lead,
            duplicate: false,
            qualified: qualResult.qualified,
        };
    }

    /**
     * Process webhook payload
     */
    async processWebhook(payload: Record<string, unknown>, signature?: string): Promise<{
        success: boolean;
        lead?: Lead;
        error?: string;
    }> {
        const webhook = this.getAdapter<WebhookReceiver>('webhook');
        if (!webhook) {
            return { success: false, error: 'Webhook adapter not configured' };
        }

        const discovered = webhook.processPayload(payload, signature);
        if (!discovered) {
            return { success: false, error: 'Invalid payload' };
        }

        const result = await this.importLead(discovered, 'inbound');
        if (result.duplicate) {
            return { success: false, error: 'Lead already exists' };
        }

        return { success: true, lead: result.lead || undefined };
    }

    /**
     * Import from CSV/JSON file
     */
    async importFile(content: string, format: 'csv' | 'json'): Promise<{
        imported: number;
        qualified: number;
        duplicates: number;
        errors: string[];
    }> {
        const importer = this.getAdapter<FileImporter>('file');
        if (!importer) {
            return { imported: 0, qualified: 0, duplicates: 0, errors: ['File importer not configured'] };
        }

        let discovered: DiscoveredLead[];

        if (format === 'csv') {
            discovered = importer.parseCSV(content);
        } else {
            discovered = importer.parseJSON(JSON.parse(content));
        }

        const results = {
            imported: 0,
            qualified: 0,
            duplicates: 0,
            errors: [] as string[],
        };

        for (const leadData of discovered) {
            try {
                const result = await this.importLead(leadData, 'import');

                if (result.duplicate) {
                    results.duplicates++;
                } else if (result.lead) {
                    results.imported++;
                    if (result.qualified) {
                        results.qualified++;
                    }
                }
            } catch (error) {
                results.errors.push(error instanceof Error ? error.message : 'Unknown error');
            }
        }

        return results;
    }
}

// Singleton
export const discovery = new DiscoveryManager();
