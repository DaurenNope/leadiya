/**
 * Chrome Extension Logic Tests
 * Tests pure-logic functions extracted from popup.js
 * 
 * Since popup.js runs in the browser context, we test the
 * data transformation and validation logic separately.
 */
import { describe, it, expect } from 'vitest';

// ---- Extracted logic from popup.js ----

/**
 * Normalize phone numbers (logic from popup.js lead extraction)
 */
function normalizePhone(raw: string): string {
    if (!raw) return '';
    // Strip non-digit characters except leading +
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return (hasPlus ? '+' : '') + digits;
}

/**
 * Deduplicate leads by phone number (core logic from multi-page scraping)
 */
function deduplicateLeads(leads: Array<{ phone?: string; companyName: string }>): Array<{ phone?: string; companyName: string }> {
    const seen = new Set<string>();
    return leads.filter(lead => {
        if (!lead.phone) return true; // Keep leads without phone (can't dedup)
        const normalized = normalizePhone(lead.phone);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

/**
 * Parse pagination info from 2GIS-style search results
 */
function parsePaginationInfo(totalText: string): { total: number; pages: number } {
    // Extract number like "Найдено 1234 результата" or "1 234 results"
    const cleaned = totalText.replace(/\s/g, '').replace(/[^\d]/g, '');
    const total = parseInt(cleaned, 10) || 0;
    const perPage = 12; // 2GIS shows 12 per page
    const pages = Math.ceil(total / perPage);
    return { total, pages };
}

/**
 * Generate batch chunks for sending leads to API
 */
function chunkLeads<T>(leads: T[], batchSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < leads.length; i += batchSize) {
        chunks.push(leads.slice(i, i + batchSize));
    }
    return chunks;
}

/**
 * Validate lead data before sending to API
 */
function validateLead(lead: { companyName?: string; phone?: string; email?: string }): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!lead.companyName || lead.companyName.trim() === '') {
        errors.push('Company name is required');
    }

    if (lead.phone && !/^\+?\d{7,15}$/.test(lead.phone.replace(/\D/g, ''))) {
        errors.push('Invalid phone format');
    }

    if (lead.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) {
        errors.push('Invalid email format');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Extract domain from URL
 */
function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace('www.', '');
    } catch {
        return '';
    }
}

// ---- TESTS ----

describe('Extension Logic', () => {

    describe('normalizePhone()', () => {
        it('should strip non-digit characters', () => {
            expect(normalizePhone('+7 (777) 123-45-67')).toBe('+77771234567');
        });

        it('should preserve leading +', () => {
            expect(normalizePhone('+77771234567')).toBe('+77771234567');
        });

        it('should handle digits only', () => {
            expect(normalizePhone('87771234567')).toBe('87771234567');
        });

        it('should return empty for empty input', () => {
            expect(normalizePhone('')).toBe('');
        });

        it('should return empty for non-numeric input', () => {
            expect(normalizePhone('no phone')).toBe('');
        });
    });

    describe('deduplicateLeads()', () => {
        it('should remove duplicate phones', () => {
            const leads = [
                { phone: '+77771234567', companyName: 'Company A' },
                { phone: '+7 (777) 123-45-67', companyName: 'Company A Duplicate' },
                { phone: '+77779999999', companyName: 'Company B' },
            ];

            const result = deduplicateLeads(leads);
            expect(result).toHaveLength(2);
            expect(result[0].companyName).toBe('Company A');
            expect(result[1].companyName).toBe('Company B');
        });

        it('should keep leads without phone', () => {
            const leads = [
                { companyName: 'No Phone 1' },
                { companyName: 'No Phone 2' },
            ];
            expect(deduplicateLeads(leads)).toHaveLength(2);
        });

        it('should handle empty array', () => {
            expect(deduplicateLeads([])).toHaveLength(0);
        });

        it('should keep first occurrence on duplicate', () => {
            const leads = [
                { phone: '111', companyName: 'First' },
                { phone: '111', companyName: 'Second' },
            ];
            const result = deduplicateLeads(leads);
            expect(result[0].companyName).toBe('First');
        });
    });

    describe('parsePaginationInfo()', () => {
        it('should parse Russian "Найдено X результатов"', () => {
            const result = parsePaginationInfo('Найдено 1234 результата');
            expect(result.total).toBe(1234);
            expect(result.pages).toBe(103); // ceil(1234/12)
        });

        it('should handle numbers with spaces (1 234)', () => {
            const result = parsePaginationInfo('1 234 организации');
            expect(result.total).toBe(1234);
        });

        it('should return 0 for no numbers', () => {
            const result = parsePaginationInfo('No results');
            expect(result.total).toBe(0);
            expect(result.pages).toBe(0);
        });

        it('should handle small result counts', () => {
            const result = parsePaginationInfo('5 найдено');
            expect(result.total).toBe(5);
            expect(result.pages).toBe(1);
        });
    });

    describe('chunkLeads()', () => {
        it('should split into correct batch sizes', () => {
            const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const chunks = chunkLeads(items, 3);
            expect(chunks).toHaveLength(4);
            expect(chunks[0]).toEqual([1, 2, 3]);
            expect(chunks[3]).toEqual([10]);
        });

        it('should handle exact batch size', () => {
            const items = [1, 2, 3, 4, 5, 6];
            const chunks = chunkLeads(items, 3);
            expect(chunks).toHaveLength(2);
        });

        it('should handle single batch', () => {
            const items = [1, 2];
            const chunks = chunkLeads(items, 10);
            expect(chunks).toHaveLength(1);
        });

        it('should handle empty array', () => {
            expect(chunkLeads([], 5)).toHaveLength(0);
        });
    });

    describe('validateLead()', () => {
        it('should pass valid lead', () => {
            const result = validateLead({
                companyName: 'Test Corp',
                phone: '+77771234567',
                email: 'test@example.com',
            });
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should fail without company name', () => {
            const result = validateLead({ companyName: '' });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Company name is required');
        });

        it('should fail with invalid email', () => {
            const result = validateLead({
                companyName: 'Test',
                email: 'not-an-email',
            });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Invalid email format');
        });

        it('should fail with too-short phone', () => {
            const result = validateLead({
                companyName: 'Test',
                phone: '123',
            });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Invalid phone format');
        });

        it('should pass with only company name', () => {
            const result = validateLead({ companyName: 'Solo Name' });
            expect(result.valid).toBe(true);
        });
    });

    describe('extractDomain()', () => {
        it('should extract domain from full URL', () => {
            expect(extractDomain('https://www.example.com/path')).toBe('example.com');
        });

        it('should handle URLs without www', () => {
            expect(extractDomain('https://api.example.com')).toBe('api.example.com');
        });

        it('should return empty for invalid URL', () => {
            expect(extractDomain('not a url')).toBe('');
        });

        it('should handle URL with port', () => {
            expect(extractDomain('http://localhost:3000')).toBe('localhost');
        });
    });
});
