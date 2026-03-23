import { createHash } from 'node:crypto';
import { DiscoveredLead } from '@leadiya/types';
import { leadRepository, FoundationLead, UUID, BIN } from '@leadiya/db';
import { LeadFactory } from './factory.js';

export class DiscoveryLogic {
    async importLead(data: DiscoveredLead, source: string = 'scrape', tenantId: string): Promise<{ lead: FoundationLead | null; duplicate: boolean }> {
        if (!this.isDiscoveryQualified(data)) {
            return { lead: null, duplicate: false };
        }

        // Dedup checks
        if (data.email && await leadRepository.existsByEmail(data.email)) {
            return { lead: null, duplicate: true };
        }
        if (data.phone && await leadRepository.existsByPhone(data.phone)) {
            return { lead: null, duplicate: true };
        }
        if (data.companyName) {
            const exists = await leadRepository.companyNameExists(data.companyName);
            if (exists) return { lead: null, duplicate: true };
        }

        const idSeed = `${data.companyName.toLowerCase().trim()}|${(data.city || 'KZ').toLowerCase().trim()}`;
        const id = createHash('sha256').update(idSeed).digest('hex').substring(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5') as UUID;

        const normalizedPhone = data.phone ? LeadFactory.normalizePhone(data.phone) : undefined;

        const lead = LeadFactory.create({
            id,
            tenantId: tenantId as UUID,
            company: {
                name: data.companyName,
                status: 'active',
                bin: data.bin as BIN | undefined,
            },
            contacts: [
                {
                    id: crypto.randomUUID() as UUID,
                    role: 'company',
                    seniority: 'unknown',
                    phones: normalizedPhone ? [{
                        number: normalizedPhone,
                        type: 'work',
                        isPrimary: true,
                        source: source
                    }] : [],
                    emails: data.email ? [{
                        address: data.email,
                        type: 'work',
                        isPrimary: true,
                        source: source
                    }] : [],
                    socialProfiles: [
                        ...(data.instagram ? [{ platform: 'instagram', url: data.instagram }] : []),
                        ...(data.telegram ? [{ platform: 'telegram', url: data.telegram }] : []),
                        ...(data.whatsapp ? [{ platform: 'whatsapp', url: data.whatsapp }] : []),
                    ],
                    discoveredAt: new Date().toISOString(),
                    sources: [source]
                }
            ],
            industries: data.industry ? [
                {
                    code: 'unknown',
                    name: data.industry,
                    source: source,
                    isPrimary: true
                }
            ] : (data.signals && data.signals.length > 0 ? [{
                code: 'unknown',
                name: data.signals[0],
                source: source,
                isPrimary: true
            }] : []),
            locations: data.address ? [
                {
                    type: 'office',
                    country: 'Kazakhstan',
                    city: data.city || 'Almaty',
                    address: data.address,
                    isPrimary: true
                }
            ] : [],
            signals: {
                hasDirectPhone: !!data.phone,
                hasWebsite: !!data.website,
                hasSocialMedia: !!(data.instagram || data.telegram || data.whatsapp),
                tags: data.signals || [],
                dataQualityScore: 0, // Will be calculated below
            },
            sourceData: {
                [source]: {
                    raw: data.rawData || data,
                    scrapedAt: new Date().toISOString(),
                    url: data.sourceUrl,
                    scraperVersion: '2.0.0'
                }
            },
            pipeline: {
                state: 'discovered',
                source: source,
                tags: data.signals || [],
                notes: [],
                contactAttempts: 0,
            }
        });

        // Re-calculate quality score after data is mapped
        lead.signals.dataQualityScore = LeadFactory.calculateQualityScore(lead);

        const created = await leadRepository.create(lead);
        return { lead: created, duplicate: false };
    }

    private isDiscoveryQualified(data: DiscoveredLead): boolean {
        if (!data.companyName || data.companyName.length < 3) return false;
        
        // Relaxing gate: phone is no longer strictly required at discovery stage
        // as we can enrich it later using official sources (DataEgov/Goszakup)
        return true;
    }
}

export const discoveryLogic = new DiscoveryLogic();
