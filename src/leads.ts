/**
 * Lead Repository
 * Manages lead storage and retrieval via Supabase (PostgreSQL)
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Lead, LeadState, LeadSource, Message } from './types.js';

// Map a Lead object → Supabase row
function leadToRow(lead: Lead): Record<string, unknown> {
    return {
        id: lead.id,
        first_name: lead.firstName || '',
        last_name: lead.lastName || '',
        email: lead.email || null,
        phone: lead.phone || null,
        whatsapp_number: lead.whatsappNumber || null,
        company_name: lead.companyName || '',
        bin: lead.bin || null,
        industry: lead.industry || null,
        website: lead.website || null,
        linkedin_url: lead.linkedinUrl || null,
        twitter_handle: lead.twitterHandle || null,
        telegram_handle: lead.telegramHandle || null,
        state: lead.state || 'discovered',
        source: lead.source || 'manual',
        source_url: lead.sourceUrl || null,
        score: lead.score || 0,
        contact_attempts: lead.contactAttempts || 0,
        needs_research: lead.needsResearch || false,
        data_completeness: lead.dataCompleteness || 'minimal',
        job_title: (lead as any).jobTitle || null,
        address: (lead as any).address || null,
        signal_summary: lead.signalSummary || null,
        pain_point: lead.painPoint || null,
        current_sequence: lead.currentSequence || null,
        current_step_id: lead.currentStepId || null,
        last_contacted_at: lead.lastContactedAt || null,
        next_contact_at: lead.nextContactAt || null,
        tags: lead.tags || [],
        notes: lead.notes || [],
        contacts: lead.contacts || [],
        conversation_history: lead.conversationHistory || [],
        created_at: lead.createdAt || new Date().toISOString(),
        updated_at: lead.updatedAt || new Date().toISOString(),
    };
}

// Map a Supabase row → Lead object
function rowToLead(row: any): Lead {
    return {
        id: row.id,
        firstName: row.first_name || '',
        lastName: row.last_name || undefined,
        email: row.email || undefined,
        phone: row.phone || undefined,
        whatsappNumber: row.whatsapp_number || undefined,
        companyName: row.company_name || '',
        bin: row.bin || undefined,
        companySize: undefined,
        industry: row.industry || undefined,
        website: row.website || undefined,
        linkedinUrl: row.linkedin_url || undefined,
        twitterHandle: row.twitter_handle || undefined,
        telegramHandle: row.telegram_handle || undefined,
        contacts: row.contacts || [],
        state: row.state || 'discovered',
        score: row.score || 0,
        source: row.source || 'manual',
        sourceUrl: row.source_url || undefined,
        signalSummary: row.signal_summary || undefined,
        recentActivity: undefined,
        painPoint: row.pain_point || undefined,
        currentSequence: row.current_sequence || undefined,
        currentStepId: row.current_step_id || undefined,
        lastContactedAt: row.last_contacted_at ? new Date(row.last_contacted_at) : undefined,
        nextContactAt: row.next_contact_at ? new Date(row.next_contact_at) : undefined,
        contactAttempts: row.contact_attempts || 0,
        lastMessageSent: undefined,
        lastMessageReceived: undefined,
        conversationHistory: row.conversation_history || [],
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        tags: row.tags || [],
        notes: row.notes || [],
        needsResearch: row.needs_research || false,
        dataCompleteness: row.data_completeness || 'minimal',
    };
}

export class LeadRepository {
    private supabase: SupabaseClient;
    private connected = false;

    constructor() {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_ANON_KEY;

        if (!url || !key) {
            console.warn('⚠️  SUPABASE_URL or SUPABASE_ANON_KEY not set — leads will fail');
        }

        this.supabase = createClient(url || '', key || '');
    }

    /**
     * Connect (verify connection works)
     */
    async connect(): Promise<void> {
        if (this.connected) return;
        // Test the connection by doing a simple count
        const { error } = await this.supabase.from('leads').select('id', { count: 'exact', head: true });
        if (error) {
            console.error('Supabase connection error:', error.message);
            // Table might not exist yet — that's ok, setup script will create it
        }
        this.connected = true;
        console.log('✅ Connected to Supabase (PostgreSQL)');
    }

    /**
     * Disconnect (no-op for Supabase — connection is stateless HTTP)
     */
    async disconnect(): Promise<void> {
        this.connected = false;
    }

    /**
     * Generate a unique lead ID
     */
    private generateId(): string {
        return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Create a new lead
     */
    async create(data: Partial<Lead>): Promise<Lead> {
        await this.connect();

        const lead: Lead = {
            id: this.generateId(),
            firstName: data.firstName || 'Unknown',
            lastName: data.lastName,
            email: data.email,
            phone: data.phone,
            companyName: data.companyName || 'Unknown',
            bin: data.bin,
            companySize: data.companySize,
            industry: data.industry,
            website: data.website,
            linkedinUrl: data.linkedinUrl,
            twitterHandle: data.twitterHandle,
            telegramHandle: data.telegramHandle,
            whatsappNumber: data.whatsappNumber,
            contacts: data.contacts || [],
            state: data.state || 'discovered',
            score: data.score || 0,
            source: data.source || 'manual',
            sourceUrl: data.sourceUrl,
            signalSummary: data.signalSummary,
            recentActivity: data.recentActivity,
            painPoint: data.painPoint,
            currentSequence: data.currentSequence,
            currentStepId: data.currentStepId,
            lastContactedAt: data.lastContactedAt,
            nextContactAt: data.nextContactAt,
            contactAttempts: data.contactAttempts || 0,
            lastMessageSent: data.lastMessageSent,
            lastMessageReceived: data.lastMessageReceived,
            conversationHistory: data.conversationHistory || [],
            createdAt: new Date(),
            updatedAt: new Date(),
            tags: data.tags || [],
            notes: data.notes || [],
            needsResearch: data.needsResearch,
            dataCompleteness: data.dataCompleteness,
        };

        const row = leadToRow(lead);
        const { error } = await this.supabase.from('leads').insert(row);

        if (error) {
            console.error('Failed to create lead:', error.message);
            throw new Error(`Failed to create lead: ${error.message}`);
        }

        return lead;
    }

    /**
     * Get a lead by ID
     */
    async get(leadId: string): Promise<Lead | null> {
        await this.connect();

        const { data, error } = await this.supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .maybeSingle();

        if (error) {
            console.error('Failed to get lead:', error.message);
            return null;
        }

        return data ? rowToLead(data) : null;
    }

    /**
     * Update a lead
     */
    async update(leadId: string, updates: Partial<Lead>): Promise<Lead | null> {
        const lead = await this.get(leadId);
        if (!lead) return null;

        // Apply updates to in-memory object
        Object.assign(lead, updates, { updatedAt: new Date() });

        const row = leadToRow(lead);
        const { error } = await this.supabase
            .from('leads')
            .update(row)
            .eq('id', leadId);

        if (error) {
            console.error('Failed to update lead:', error.message);
            return null;
        }

        return lead;
    }

    /**
     * Delete a lead
     */
    async delete(leadId: string): Promise<boolean> {
        await this.connect();

        const { error } = await this.supabase
            .from('leads')
            .delete()
            .eq('id', leadId);

        if (error) {
            console.error('Failed to delete lead:', error.message);
            return false;
        }

        return true;
    }

    /**
     * Get all leads
     */
    async getAll(): Promise<Lead[]> {
        await this.connect();

        const { data, error } = await this.supabase
            .from('leads')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Failed to get all leads:', error.message);
            return [];
        }

        return (data || []).map(rowToLead);
    }

    /**
     * Get leads by state
     */
    async getByState(state: LeadState): Promise<Lead[]> {
        await this.connect();

        const { data, error } = await this.supabase
            .from('leads')
            .select('*')
            .eq('state', state)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Failed to get leads by state:', error.message);
            return [];
        }

        return (data || []).map(rowToLead);
    }

    /**
     * Get leads by source
     */
    async getBySource(source: LeadSource): Promise<Lead[]> {
        await this.connect();

        const { data, error } = await this.supabase
            .from('leads')
            .select('*')
            .eq('source', source)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Failed to get leads by source:', error.message);
            return [];
        }

        return (data || []).map(rowToLead);
    }

    /**
     * Find leads ready for next outreach step
     */
    async getReadyForOutreach(): Promise<Lead[]> {
        const contacted = await this.getByState('contacted');
        const qualified = await this.getByState('qualified');

        const now = new Date();

        return [...contacted, ...qualified].filter(lead => {
            if (!lead.nextContactAt) return lead.state === 'qualified';
            return new Date(lead.nextContactAt) <= now;
        });
    }

    /**
     * Add a message to lead's conversation history
     */
    async addMessage(leadId: string, message: Omit<Message, 'id'>): Promise<void> {
        const lead = await this.get(leadId);
        if (!lead) return;

        const msg: Message = {
            ...message,
            id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        };

        lead.conversationHistory.push(msg);

        if (message.direction === 'outbound') {
            lead.lastMessageSent = message.content;
            lead.lastContactedAt = message.timestamp;
            lead.contactAttempts++;
        } else {
            lead.lastMessageReceived = message.content;
        }

        await this.update(leadId, {
            conversationHistory: lead.conversationHistory,
            lastMessageSent: lead.lastMessageSent,
            lastMessageReceived: lead.lastMessageReceived,
            lastContactedAt: lead.lastContactedAt,
            contactAttempts: lead.contactAttempts,
        });
    }

    /**
     * Get pipeline stats
     */
    async getStats(): Promise<{
        total: number;
        byState: Record<string, number>;
        bySource: Record<string, number>;
    }> {
        await this.connect();

        const allLeads = await this.getAll();
        const byState: Record<string, number> = {};
        const bySource: Record<string, number> = {};

        for (const lead of allLeads) {
            byState[lead.state] = (byState[lead.state] || 0) + 1;
            bySource[lead.source] = (bySource[lead.source] || 0) + 1;
        }

        return { total: allLeads.length, byState, bySource };
    }

    /**
     * Find lead by company name
     */
    async findByCompany(companyName: string): Promise<Lead | null> {
        await this.connect();

        const normalized = companyName.toLowerCase().trim();
        const { data, error } = await this.supabase
            .from('leads')
            .select('*')
            .ilike('company_name', normalized);

        if (error || !data || data.length === 0) return null;
        return rowToLead(data[0]);
    }

    /**
     * Check if lead exists by email
     */
    async existsByEmail(email: string): Promise<boolean> {
        await this.connect();

        const { count, error } = await this.supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .ilike('email', email);

        return !error && (count || 0) > 0;
    }

    /**
     * Bulk create/upsert leads — inserts in batches of 100,
     * merges on conflict (by id). Returns { inserted, skipped, errors }.
     */
    async bulkUpsert(leadsData: Partial<Lead>[]): Promise<{ inserted: number; skipped: number; errors: number }> {
        await this.connect();

        let inserted = 0;
        let skipped = 0;
        let errors = 0;

        // Process in chunks of 100
        const BATCH = 100;
        for (let i = 0; i < leadsData.length; i += BATCH) {
            const batch = leadsData.slice(i, i + BATCH);

            const rows = batch.map(partial => {
                const lead: Lead = {
                    id: partial.id || `lead_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    firstName: partial.firstName || '',
                    companyName: partial.companyName || '',
                    contacts: partial.contacts || [],
                    state: partial.state || 'discovered',
                    score: partial.score || 0,
                    source: partial.source || 'scrape',
                    contactAttempts: partial.contactAttempts || 0,
                    conversationHistory: partial.conversationHistory || [],
                    createdAt: partial.createdAt || new Date(),
                    updatedAt: new Date(),
                    tags: partial.tags || [],
                    notes: partial.notes || [],
                    needsResearch: partial.needsResearch ?? false,
                    dataCompleteness: partial.dataCompleteness || 'minimal',
                    ...partial,
                } as Lead;

                return leadToRow(lead);
            });

            const { data, error } = await this.supabase
                .from('leads')
                .upsert(rows, { onConflict: 'id' })
                .select('id');

            if (error) {
                console.error(`Bulk upsert error (batch ${i / BATCH + 1}):`, error.message);
                errors += batch.length;
            } else {
                inserted += (data?.length || 0);
            }
        }

        return { inserted, skipped, errors };
    }

    /**
     * Check if lead exists by phone/WhatsApp
     */
    async existsByPhone(phone: string): Promise<boolean> {
        await this.connect();

        const normalized = phone.replace(/\D/g, '');
        // Check both phone and whatsapp columns
        const { data, error } = await this.supabase
            .from('leads')
            .select('id, phone, whatsapp_number');

        if (error || !data) return false;

        return data.some(row =>
            (row.phone?.replace(/\D/g, '') === normalized) ||
            (row.whatsapp_number?.replace(/\D/g, '') === normalized)
        );
    }
}

// Singleton instance
export const leads = new LeadRepository();
