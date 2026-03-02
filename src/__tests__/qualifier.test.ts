/**
 * Qualifier Unit Tests
 * Tests lead scoring against ICP criteria
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Qualifier } from '../qualifier.js';
import type { Lead } from '../types.js';

// Mock ConfigLoader that returns controlled ICP config
function createMockConfig() {
    return {
        loadICP: () => ({
            targeting: {
                industries: {
                    include: ['Education', 'Logistics', 'Real Estate'],
                    exclude: ['Government', 'Military'],
                    weight: 30,
                },
                companySize: {
                    min: 10,
                    max: 500,
                    idealMin: 20,
                    idealMax: 200,
                    weight: 20,
                },
                roles: {
                    include: ['CEO', 'CTO', 'Founder', 'Director'],
                    exclude: ['Intern', 'Student'],
                    weight: 15,
                },
            },
            signals: {
                strongPositive: [
                    { pattern: 'building mvp', score: 25 },
                    { pattern: 'raised funding', score: 20 },
                ],
                moderatePositive: [
                    { pattern: 'hiring engineers', score: 10 },
                    { pattern: 'want to automate', score: 10 },
                ],
                negative: [
                    { pattern: 'not hiring', score: -5 },
                    { pattern: 'bankrupt', score: -100 },
                ],
            },
            thresholds: {
                qualified: 30,
                hot: 60,
            },
        }),
        loadBusiness: vi.fn(),
        loadSequences: vi.fn(),
        loadAll: vi.fn(),
        reload: vi.fn(),
    } as any;
}

describe('Qualifier', () => {
    let qualifier: Qualifier;

    beforeEach(() => {
        qualifier = new Qualifier(createMockConfig());
    });

    describe('qualify()', () => {
        it('should score industry match with full weight', () => {
            const result = qualifier.qualify({
                industry: 'Education',
            });
            expect(result.breakdown.industry).toBe(30);
        });

        it('should disqualify excluded industries', () => {
            const result = qualifier.qualify({
                industry: 'Government',
            });
            expect(result.breakdown.industry).toBe(-100);
            expect(result.disqualifyReasons).toContain('Excluded industry: Government');
            expect(result.qualified).toBe(false);
        });

        it('should score 0 for unknown industries', () => {
            const result = qualifier.qualify({
                industry: 'Cryptocurrency',
            });
            expect(result.breakdown.industry).toBe(0);
        });

        it('should give full weight for ideal company size', () => {
            const result = qualifier.qualify({
                companySize: 50,
            });
            expect(result.breakdown.companySize).toBe(20);
        });

        it('should give partial score for in-range but not ideal size', () => {
            const result = qualifier.qualify({
                companySize: 15, // min=10, idealMin=20
            });
            expect(result.breakdown.companySize).toBe(12); // 20 * 0.6
        });

        it('should give 0 for out-of-range company size', () => {
            const result = qualifier.qualify({
                companySize: 1000,
            });
            expect(result.breakdown.companySize).toBe(0);
        });

        it('should detect strong positive signals', () => {
            const result = qualifier.qualify({
                recentActivity: 'We are building MVP for our startup',
            });
            expect(result.breakdown.signals).toBeGreaterThanOrEqual(25);
            expect(result.matchedSignals).toContain('building mvp');
        });

        it('should accumulate multiple signals', () => {
            const result = qualifier.qualify({
                recentActivity: 'building mvp and raised funding',
            });
            expect(result.breakdown.signals).toBe(45); // 25 + 20
            expect(result.matchedSignals).toHaveLength(2);
        });

        it('should detect negative signals', () => {
            const result = qualifier.qualify({
                recentActivity: 'company is bankrupt',
            });
            expect(result.breakdown.signals).toBe(-100);
            expect(result.disqualifyReasons).toContain('Negative signal: bankrupt');
        });

        it('should mark as qualified when above threshold', () => {
            const result = qualifier.qualify({
                industry: 'Education',       // +30
                companySize: 50,              // +20
            });
            expect(result.score).toBeGreaterThanOrEqual(30);
            expect(result.qualified).toBe(true);
        });

        it('should mark as hot when above hot threshold', () => {
            const result = qualifier.qualify({
                industry: 'Education',                    // +30
                companySize: 50,                          // +20
                recentActivity: 'building mvp',           // +25
            });
            expect(result.score).toBeGreaterThanOrEqual(60);
            expect(result.hot).toBe(true);
        });

        it('should clamp score at 0 minimum', () => {
            const result = qualifier.qualify({
                recentActivity: 'bankrupt',
            });
            expect(result.score).toBe(0);
        });

        it('should detect roles in recentActivity text', () => {
            const result = qualifier.qualify({
                recentActivity: 'Just promoted to CTO',
            });
            expect(result.breakdown.role).toBe(15);
        });

        it('should disqualify excluded roles', () => {
            const result = qualifier.qualify({
                recentActivity: 'Current Intern at company',
            });
            expect(result.breakdown.role).toBe(-50);
            expect(result.qualified).toBe(false);
        });
    });

    describe('extractSignals()', () => {
        it('should extract signals from text', () => {
            const signals = qualifier.extractSignals('We are building mvp and hiring engineers');
            expect(signals).toHaveLength(2);
            expect(signals.map(s => s.pattern)).toContain('building mvp');
            expect(signals.map(s => s.pattern)).toContain('hiring engineers');
        });

        it('should return empty for no matches', () => {
            const signals = qualifier.extractSignals('Normal company doing normal things');
            expect(signals).toHaveLength(0);
        });

        it('should be case insensitive', () => {
            const signals = qualifier.extractSignals('BUILDING MVP');
            expect(signals).toHaveLength(1);
        });
    });

    describe('generateSignalSummary()', () => {
        it('should return empty string for no signals', () => {
            expect(qualifier.generateSignalSummary([])).toBe('');
        });

        it('should prioritize key signals', () => {
            const summary = qualifier.generateSignalSummary(['building mvp', 'hiring engineers']);
            expect(summary).toBe('building something new');
        });

        it('should fallback to first signal when no priority match', () => {
            const summary = qualifier.generateSignalSummary(['some random signal']);
            expect(summary).toBe('some random signal');
        });
    });
});
