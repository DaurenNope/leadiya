/**
 * Lead Enrichment Service
 * Enriches leads with additional data from various sources
 */

import type { Lead } from './types.js';
import { leads as leadRepo } from './leads.js';

export interface EnrichmentResult {
    leadId: string;
    enriched: boolean;
    fieldsUpdated: string[];
    source: string;
}

export class LeadEnrichmentService {
    /**
     * Enrich a single lead with additional data
     */
    async enrichLead(leadId: string): Promise<EnrichmentResult> {
        const lead = await leadRepo.get(leadId);
        if (!lead) {
            return { leadId, enriched: false, fieldsUpdated: [], source: 'none' };
        }

        const updates: Partial<Lead> = {};
        const fieldsUpdated: string[] = [];
        let source = '';

        // 1. Try to extract director name from company name patterns
        if (!lead.firstName || lead.firstName === 'Директор') {
            // Check if we have BIN in tags
            const binTag = lead.tags?.find(t => /^\d{12}$/.test(t));
            if (binTag) {
                // Could call Kompra API here to get director name
                source = 'kompra_bin';
            }
        }

        // 2. Normalize phone number
        if (lead.phone) {
            const normalized = this.normalizePhone(lead.phone);
            if (normalized !== lead.phone) {
                updates.phone = normalized;
                fieldsUpdated.push('phone');
            }

            // Set WhatsApp number if not present
            if (!lead.whatsappNumber) {
                updates.whatsappNumber = normalized;
                fieldsUpdated.push('whatsappNumber');
            }
        }

        // 3. Add region tag based on phone number
        if (lead.phone && !lead.tags?.some(t => ['KZ', 'RU', 'US'].includes(t))) {
            const region = this.detectRegionFromPhone(lead.phone);
            if (region) {
                updates.tags = [...(lead.tags || []), region];
                fieldsUpdated.push('region_tag');
            }
        }

        // 4. Clean up company name
        if (lead.companyName) {
            const cleanName = this.cleanCompanyName(lead.companyName);
            if (cleanName !== lead.companyName) {
                updates.companyName = cleanName;
                fieldsUpdated.push('companyName');
            }
        }

        // 5. Auto-tag based on industry signals
        if (lead.signalSummary && !lead.tags?.length) {
            const autoTags = this.extractIndustryTags(lead.signalSummary);
            if (autoTags.length) {
                updates.tags = [...(lead.tags || []), ...autoTags];
                fieldsUpdated.push('tags');
            }
        }

        // Apply updates
        if (fieldsUpdated.length > 0) {
            await leadRepo.update(leadId, updates);
            return { leadId, enriched: true, fieldsUpdated, source: source || 'internal' };
        }

        return { leadId, enriched: false, fieldsUpdated: [], source: 'none' };
    }

    /**
     * Batch enrich multiple leads
     */
    async enrichBatch(leadIds: string[]): Promise<{
        total: number;
        enriched: number;
        results: EnrichmentResult[];
    }> {
        const results: EnrichmentResult[] = [];
        let enrichedCount = 0;

        for (const leadId of leadIds) {
            const result = await this.enrichLead(leadId);
            results.push(result);
            if (result.enriched) enrichedCount++;
        }

        return {
            total: leadIds.length,
            enriched: enrichedCount,
            results
        };
    }

    /**
     * Normalize phone number to international format
     */
    private normalizePhone(phone: string): string {
        // Remove all non-digits
        let digits = phone.replace(/\D/g, '');

        // Kazakhstan numbers
        if (digits.startsWith('8') && digits.length === 11) {
            digits = '7' + digits.slice(1);
        }

        // Add + prefix
        if (!digits.startsWith('+')) {
            return '+' + digits;
        }

        return digits;
    }

    /**
     * Detect region from phone number
     */
    private detectRegionFromPhone(phone: string): string | null {
        const digits = phone.replace(/\D/g, '');

        // Kazakhstan (starts with 7)
        if (digits.startsWith('7')) {
            const code = digits.slice(1, 4);
            // Almaty
            if (['727', '700', '701', '702', '705', '707', '708', '747', '771', '775', '776', '777', '778'].includes(code)) {
                return 'KZ';
            }
        }

        // Russia (starts with 7 but different codes)
        if (digits.startsWith('7') && digits.length === 11) {
            const code = digits.slice(1, 4);
            if (code.startsWith('9') || code.startsWith('4') || code.startsWith('8')) {
                return 'RU';
            }
        }

        // US (starts with 1)
        if (digits.startsWith('1') && digits.length === 11) {
            return 'US';
        }

        return null;
    }

    /**
     * Clean company name
     */
    private cleanCompanyName(name: string): string {
        return name
            .replace(/\s+/g, ' ')  // Multiple spaces
            .replace(/[«»""]/g, '"')  // Normalize quotes
            .replace(/ТОО\s+/gi, 'ТОО ')  // Normalize legal form
            .replace(/ИП\s+/gi, 'ИП ')
            .trim();
    }

    /**
     * Extract industry tags from signal summary
     */
    private extractIndustryTags(signalSummary: string): string[] {
        const lower = signalSummary.toLowerCase();
        const tags: string[] = [];

        const industries: Record<string, string[]> = {
            'education': ['образование', 'университет', 'школа', 'колледж', 'обучение', 'курс'],
            'logistics': ['логистика', 'транспорт', 'перевозки', 'доставка', 'склад'],
            'realestate': ['недвижимость', 'застройщик', 'строительство', 'девелопмент'],
            'horeca': ['ресторан', 'кафе', 'гостиница', 'отель', 'общепит'],
            'retail': ['магазин', 'торговля', 'опт', 'розница'],
            'medical': ['клиника', 'медицина', 'стоматология', 'здоровье'],
            'beauty': ['салон', 'красота', 'спа', 'косметология']
        };

        for (const [tag, keywords] of Object.entries(industries)) {
            if (keywords.some(kw => lower.includes(kw))) {
                tags.push(tag);
            }
        }

        return tags;
    }
}

// Singleton
export const enrichmentService = new LeadEnrichmentService();
