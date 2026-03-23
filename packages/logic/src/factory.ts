import {
    FoundationLead,
    FoundationContact,
    UUID,
    CompanyStatus,
} from '@leadiya/db'

export class LeadFactory {
    /** 
     * Create a valid FoundationLead with defaults 
     */
    static create(data: Partial<FoundationLead> & { 
        company: { name: string }, 
        tenantId: UUID 
    }): FoundationLead {
        const now = new Date().toISOString();
        const id = data.id || (crypto.randomUUID() as UUID);

        return {
            id,
            tenantId: data.tenantId,
            company: {
                ...data.company,
                status: data.company.status || CompanyStatus.UNKNOWN,
            },
            locations: data.locations || [],
            contacts: data.contacts || [],
            industries: data.industries || [],
            signals: data.signals || {
                hasDirectPhone: false,
                hasWebsite: false,
                hasSocialMedia: false,
                tags: [],
                dataQualityScore: 0
            },
            sourceData: data.sourceData || {},
            enrichment: data.enrichment || {
                enrichmentSources: [],
                isDuplicate: false
            },
            pipeline: data.pipeline || {
                state: 'discovered',
                source: 'manual',
                tags: [],
                notes: [],
                contactAttempts: 0
            },
            exports: data.exports || {
                timesExported: 0,
                exportFormats: [],
                customerIds: []
            },
            createdAt: now,
            updatedAt: now,
            version: 1
        };
    }

    /**
     * Calculate data quality score (0-100)
     */
    static calculateQualityScore(lead: Partial<FoundationLead>): number {
        let score = 0;

        // Company data (40 points)
        if (lead.company?.name) score += 10;
        if (lead.company?.bin) score += 20;
        if (lead.company?.oked?.length) score += 10;

        // Location (20 points)
        if (lead.locations?.length) score += 20;

        // Contacts (30 points)
        if (lead.contacts?.length) {
            score += 10;
            const hasPhone = lead.contacts.some((c: FoundationContact) => c.phones?.length);
            if (hasPhone) score += 10;
            const hasEmail = lead.contacts.some((c: FoundationContact) => c.emails?.length);
            if (hasEmail) score += 10;
        }

        // Industries (10 points)
        if (lead.industries?.length) score += 10;

        return Math.min(score, 100);
    }

    /**
     * Normalize phone to international format (CIS focus)
     */
    static normalizePhone(phone: string): string {
        if (!phone || phone.includes('...')) return ''; // Reject truncated strings
        const digits = phone.replace(/\D/g, '');

        // Kazakhstan
        if (digits.length === 10 && digits.startsWith('7')) {
            return `+7${digits}`;
        }
        if (digits.length === 11 && digits.startsWith('8')) {
            return `+7${digits.slice(1)}`;
        }
        if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
            return `+${digits.startsWith('8') ? '7' + digits.slice(1) : digits}`;
        }

        // Russia/General +7
        if (digits.length === 10) {
            return `+7${digits}`;
        }

        return phone.startsWith('+') ? phone : `+${digits}`;
    }
}
