/**
 * Sales Engine - Main Entry Point
 * Orchestrates all modules and exposes skill commands
 */

import { config } from './config.js';
import { leads } from './leads.js';
import { pipeline } from './pipeline.js';
import { qualifier } from './qualifier.js';
import { outreach } from './outreach.js';
import type { Lead, LeadState, LeadSource } from './types.js';

export class SalesEngine {
    /**
     * Initialize the engine
     */
    async init(): Promise<void> {
        await leads.connect();
        console.log('🦞 Sales Engine initialized');

        const business = config.loadBusiness();
        console.log(`   Company: ${business.company.name}`);
        console.log(`   Mode: ${business.automation.mode}`);
        console.log(`   Channels: ${business.channels.primary} → ${business.channels.fallback}`);
    }

    /**
     * Shutdown the engine
     */
    async shutdown(): Promise<void> {
        await leads.disconnect();
        console.log('Sales Engine shut down');
    }

    // ===========================================================================
    // LEAD MANAGEMENT
    // ===========================================================================

    /**
     * Add a new lead manually
     */
    async addLead(data: Partial<Lead>): Promise<Lead> {
        const lead = await leads.create({
            ...data,
            source: data.source || 'manual',
        });

        // Auto-qualify
        const result = qualifier.qualify(lead);

        await leads.update(lead.id, {
            score: result.score,
            signalSummary: qualifier.generateSignalSummary(result.matchedSignals),
        });

        if (result.qualified) {
            await pipeline.process({
                type: 'LEAD_QUALIFIED',
                payload: { leadId: lead.id, score: result.score },
            });
        } else if (result.disqualifyReasons.length > 0) {
            await pipeline.process({
                type: 'LEAD_DISQUALIFIED',
                payload: { leadId: lead.id, reason: result.disqualifyReasons.join('; ') },
            });
        }

        return lead;
    }

    /**
     * Get a lead by ID
     */
    async getLead(leadId: string): Promise<Lead | null> {
        return leads.get(leadId);
    }

    /**
     * List leads with optional filters
     */
    async listLeads(filter?: {
        state?: LeadState;
        source?: LeadSource;
    }): Promise<Lead[]> {
        if (filter?.state) {
            return leads.getByState(filter.state);
        }
        if (filter?.source) {
            return leads.getBySource(filter.source);
        }
        return leads.getAll();
    }

    /**
     * Update a lead
     */
    async updateLead(leadId: string, updates: Partial<Lead>): Promise<Lead | null> {
        return leads.update(leadId, updates);
    }

    /**
     * Delete a lead
     */
    async deleteLead(leadId: string): Promise<boolean> {
        return leads.delete(leadId);
    }

    // ===========================================================================
    // PIPELINE OPERATIONS
    // ===========================================================================

    /**
     * Get pipeline summary
     */
    async getPipelineSummary() {
        return pipeline.getSummary();
    }

    /**
     * Get pipeline stats
     */
    async getStats() {
        return leads.getStats();
    }

    /**
     * Move lead to a new state
     */
    async moveLeadState(leadId: string, newState: LeadState, reason?: string): Promise<Lead | null> {
        return pipeline.transition(leadId, newState, reason);
    }

    // ===========================================================================
    // OUTREACH OPERATIONS
    // ===========================================================================

    /**
     * Start outreach sequence for a lead
     */
    async startOutreach(leadId: string, sequenceName = 'cold_outreach'): Promise<boolean> {
        return outreach.startSequence(leadId, sequenceName);
    }

    /**
     * Send next message to a lead
     */
    async sendNext(leadId: string) {
        return outreach.executeStep(leadId);
    }

    /**
     * Process all leads ready for outreach
     */
    async runOutreachCycle() {
        console.log('Running outreach cycle...');
        return outreach.processReadyLeads();
    }

    /**
     * Handle incoming response
     */
    async handleIncomingMessage(leadId: string, content: string, channel: 'whatsapp' | 'telegram' | 'email') {
        return outreach.handleResponse(leadId, content, channel);
    }

    // ===========================================================================
    // WHATSAPP INTEGRATION
    // ===========================================================================

    /**
     * Get WhatsApp connection status
     */
    async getWhatsAppStatus() {
        const { whatsapp } = await import('./channels/whatsapp.js');
        const ready = await whatsapp.isReady();
        const qr = whatsapp.getQR();
        return {
            connected: ready,
            status: ready ? 'connected' : (qr ? 'awaiting_scan' : 'disconnected'),
            phone: null,  // Phone number not exposed by adapter
            qr: qr, // QR code for UI display
            limits: {
                hourly: { remaining: 10, max: 10 },
                daily: { remaining: 30, max: 30 }
            }
        };
    }

    /**
     * Connect to WhatsApp
     */
    async connectWhatsApp() {
        const { whatsapp } = await import('./channels/whatsapp.js');
        const connected = await whatsapp.connect();
        // Wait a moment for QR to generate
        await new Promise(resolve => setTimeout(resolve, 2000));
        const qr = whatsapp.getQR();
        return {
            success: connected || !!qr,
            message: connected ? 'Connected' : (qr ? 'Scan QR code' : 'Connecting...'),
            qr: qr
        };
    }

    /**
     * Send a WhatsApp message
     */
    async sendWhatsAppMessage(phone: string, message: string) {
        const { whatsapp } = await import('./channels/whatsapp.js');
        try {
            // Normalize phone: strip non-digits, ensure proper format
            let normalizedPhone = phone.replace(/[^\d@.a-z]/gi, '');

            // Handle JID format (e.g., "175522529153262@s.whatsapp.net")
            let jid: string;
            if (normalizedPhone.includes('@')) {
                jid = normalizedPhone;
            } else {
                // Clean phone number - remove leading + if present
                normalizedPhone = normalizedPhone.replace(/^\+/, '');
                jid = normalizedPhone + '@s.whatsapp.net';
            }

            console.log('[ENGINE] Sending to JID:', jid);
            const result = await whatsapp.sendToJid(jid, message);
            return {
                success: result.success,
                error: result.error || null
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    // ===========================================================================
    // QUALIFICATION
    // ===========================================================================

    /**
     * Re-qualify a lead
     */
    async requalifyLead(leadId: string): Promise<{
        lead: Lead | null;
        result: ReturnType<typeof qualifier.qualify>;
    }> {
        const lead = await leads.get(leadId);
        if (!lead) return { lead: null, result: qualifier.qualify({}) };

        const result = qualifier.qualify(lead);

        await leads.update(leadId, {
            score: result.score,
            signalSummary: qualifier.generateSignalSummary(result.matchedSignals),
        });

        return { lead, result };
    }

    // ===========================================================================
    // BULK OPERATIONS
    // ===========================================================================

    /**
     * Import leads from array
     */
    async importLeads(leadsData: Partial<Lead>[]): Promise<{
        imported: number;
        qualified: number;
        disqualified: number;
    }> {
        const results = { imported: 0, qualified: 0, disqualified: 0 };

        for (const data of leadsData) {
            // Check for duplicates
            if (data.email && await leads.existsByEmail(data.email)) {
                console.log(`Skipping duplicate: ${data.email}`);
                continue;
            }
            if (data.phone && await leads.existsByPhone(data.phone)) {
                console.log(`Skipping duplicate: ${data.phone}`);
                continue;
            }

            await this.addLead(data);
            results.imported++;

            const lastLead = (await leads.getAll()).pop();
            if (lastLead?.state === 'qualified') {
                results.qualified++;
            } else if (lastLead?.state === 'disqualified') {
                results.disqualified++;
            }
        }

        return results;
    }

    /**
     * Add tags to a lead
     */
    async addTagsToLead(leadId: string, newTags: string[]): Promise<boolean> {
        const lead = await leads.get(leadId);
        if (!lead) return false;

        const existingTags = lead.tags || [];
        const mergedTags = [...new Set([...existingTags, ...newTags])];

        await leads.update(leadId, { tags: mergedTags });
        return true;
    }

    /**
     * Export leads to array
     */
    async exportLeads(filter?: { state?: LeadState }): Promise<Lead[]> {
        return this.listLeads(filter);
    }
}

// Singleton instance
export const engine = new SalesEngine();

// Export all modules for direct access if needed
export { config } from './config.js';
export { leads } from './leads.js';
export { pipeline } from './pipeline.js';
export { qualifier } from './qualifier.js';
export { outreach } from './outreach.js';
export * from './types.js';
