/**
 * Configuration Loader
 * Loads and validates YAML config files
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import type { BusinessConfig, ICPConfig, SequencesConfig } from './types.js';

// =============================================================================
// SCHEMAS
// =============================================================================

const BusinessSchema = z.object({
    company: z.object({
        name: z.string(),
        tagline: z.string(),
        website: z.string().url(),
        calendar_url: z.string().url(),
    }),
    product: z.object({
        name: z.string(),
        description: z.string(),
        value_props: z.array(z.string()),
        pain_points: z.array(z.string()),
    }),
    channels: z.object({
        primary: z.enum(['whatsapp', 'email', 'telegram']),
        fallback: z.enum(['whatsapp', 'email', 'telegram']),
        tertiary: z.enum(['whatsapp', 'email', 'telegram']).optional(),
    }),
    voice: z.object({
        tone: z.string(),
        language: z.string(),
        signature: z.string(),
        traits: z.array(z.string()),
    }),
    automation: z.object({
        mode: z.enum(['fully_automatic', 'approval_required', 'hybrid']),
        max_outreach_per_day: z.number().min(1).max(200),
        max_followups_per_lead: z.number().min(1).max(10),
        cooldown_after_response: z.boolean(),
    }),
    discovery: z.object({
        schedule: z.string(),
        sources: z.array(z.string()), // Flexible - any source name allowed
    }),
});

const ICPSchema = z.object({
    targeting: z.object({
        industries: z.object({
            include: z.array(z.string()),
            exclude: z.array(z.string()),
            weight: z.number(),
        }),
        company_size: z.object({
            min: z.number(),
            max: z.number(),
            ideal_min: z.number(),
            ideal_max: z.number(),
            weight: z.number(),
        }),
        roles: z.object({
            include: z.array(z.string()),
            exclude: z.array(z.string()),
            weight: z.number(),
        }),
        geography: z.object({
            include: z.array(z.string()),
            exclude: z.array(z.string()),
            weight: z.number(),
        }),
    }),
    signals: z.object({
        strong_positive: z.array(z.object({ pattern: z.string(), score: z.number() })),
        moderate_positive: z.array(z.object({ pattern: z.string(), score: z.number() })),
        negative: z.array(z.object({ pattern: z.string(), score: z.number() })),
    }),
    thresholds: z.object({
        qualified: z.number(),
        hot: z.number(),
        disqualified: z.number(),
    }),
    enrichment: z.object({
        required: z.array(z.string()),
        optional: z.array(z.string()),
    }),
});

// =============================================================================
// CONFIG LOADER
// =============================================================================

export class ConfigLoader {
    private configDir: string;
    private cache: Map<string, unknown> = new Map();

    constructor(configDir?: string) {
        this.configDir = configDir || join(process.cwd(), 'config');
    }

    /**
     * Load and parse a YAML config file
     */
    private loadYaml<T>(filename: string): T {
        const filepath = join(this.configDir, filename);

        if (!existsSync(filepath)) {
            throw new Error(`Config file not found: ${filepath}`);
        }

        const content = readFileSync(filepath, 'utf-8');
        return YAML.parse(content) as T;
    }

    /**
     * Convert snake_case keys to camelCase
     */
    private toCamelCase(obj: unknown): unknown {
        if (Array.isArray(obj)) {
            return obj.map(item => this.toCamelCase(item));
        }

        if (obj !== null && typeof obj === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
                result[camelKey] = this.toCamelCase(value);
            }
            return result;
        }

        return obj;
    }

    /**
     * Load business configuration
     */
    loadBusiness(): BusinessConfig {
        if (this.cache.has('business')) {
            return this.cache.get('business') as BusinessConfig;
        }

        const raw = this.loadYaml('business.yml');
        const validated = BusinessSchema.parse(raw);
        const config = this.toCamelCase(validated) as BusinessConfig;

        this.cache.set('business', config);
        return config;
    }

    /**
     * Load ICP configuration
     */
    loadICP(): ICPConfig {
        if (this.cache.has('icp')) {
            return this.cache.get('icp') as ICPConfig;
        }

        const raw = this.loadYaml('icp.yml');
        const validated = ICPSchema.parse(raw);
        const config = this.toCamelCase(validated) as ICPConfig;

        this.cache.set('icp', config);
        return config;
    }

    /**
     * Load sequences configuration
     */
    loadSequences(): SequencesConfig {
        if (this.cache.has('sequences')) {
            return this.cache.get('sequences') as SequencesConfig;
        }

        const raw = this.loadYaml<SequencesConfig>('sequences.yml');
        // Sequences are more flexible, skip strict validation for templates

        this.cache.set('sequences', raw);
        return raw;
    }

    /**
     * Reload all configs (clear cache)
     */
    reload(): void {
        this.cache.clear();
    }

    /**
     * Get all configs at once
     */
    loadAll(): {
        business: BusinessConfig;
        icp: ICPConfig;
        sequences: SequencesConfig;
    } {
        return {
            business: this.loadBusiness(),
            icp: this.loadICP(),
            sequences: this.loadSequences(),
        };
    }
}

// Singleton instance
export const config = new ConfigLoader();
