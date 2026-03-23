export interface QueueJob<T = any> {
    id: string;
    type: string;
    payload: T;
    tenantId?: string;
    createdAt: string;
}
export interface DiscoveryJobPayload {
    city: string;
    category: string;
}
export interface EnrichmentJobPayload {
    bin: string;
}
export interface TenderJobPayload {
    bin: string;
}
export interface DiscoveredLead {
    companyName: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    industry?: string;
    website?: string;
    address?: string;
    city?: string;
    country?: string;
    bin?: string;
    whatsapp?: string;
    telegram?: string;
    instagram?: string;
    facebook?: string;
    youtube?: string;
    tiktok?: string;
    vk?: string;
    twitter?: string;
    sourceUrl?: string;
    signals?: string[];
    rawData?: Record<string, unknown>;
}
export interface ScraperConfig {
    name: string;
    displayName: string;
    description: string;
    minIntervalMs: number;
    supportedParams: {
        query?: boolean;
        location?: boolean;
        industry?: boolean;
        companySize?: boolean;
    };
}
export interface ScraperStats {
    lastRunAt: Date | null;
    lastSuccessAt: Date | null;
    totalRuns: number;
    totalLeadsFound: number;
    averageLeadsPerRun: number;
    errorsLast24h: number;
    isHealthy: boolean;
}
