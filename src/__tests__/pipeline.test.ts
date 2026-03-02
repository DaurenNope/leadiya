/**
 * Pipeline Unit Tests
 * Tests state machine transitions and event processing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pipeline } from '../pipeline.js';
import type { Lead, LeadState, PipelineEvent } from '../types.js';

// Create a mock LeadRepository
function createMockLeadRepo() {
    const store = new Map<string, Lead>();

    return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        create: vi.fn(async (data: Partial<Lead>) => {
            const lead: Lead = {
                id: data.id || `lead_${Date.now()}`,
                firstName: data.firstName || 'Test',
                companyName: data.companyName || 'Test Co',
                state: data.state || 'discovered',
                score: data.score || 0,
                source: data.source || 'manual',
                contactAttempts: data.contactAttempts || 0,
                conversationHistory: data.conversationHistory || [],
                createdAt: new Date(),
                updatedAt: new Date(),
                tags: data.tags || [],
                notes: data.notes || [],
                contacts: data.contacts || [],
            } as Lead;
            store.set(lead.id, lead);
            return lead;
        }),
        get: vi.fn(async (id: string) => store.get(id) || null),
        update: vi.fn(async (id: string, updates: Partial<Lead>) => {
            const lead = store.get(id);
            if (!lead) return null;
            Object.assign(lead, updates, { updatedAt: new Date() });
            store.set(id, lead);
            return lead;
        }),
        delete: vi.fn(async (id: string) => store.delete(id)),
        getAll: vi.fn(async () => Array.from(store.values())),
        getByState: vi.fn(async (state: LeadState) =>
            Array.from(store.values()).filter(l => l.state === state)
        ),
        getStats: vi.fn(async () => ({
            total: store.size,
            byState: {} as Record<string, number>,
            bySource: {} as Record<string, number>,
        })),
        getReadyForOutreach: vi.fn(async () => []),
        addMessage: vi.fn(),
        _store: store,
    };
}

function createMockConfig() {
    return {
        loadICP: () => ({
            thresholds: { qualified: 30, hot: 60 },
            targeting: { industries: { include: [], exclude: [], weight: 0 } },
            signals: { strongPositive: [], moderatePositive: [], negative: [] },
        }),
        loadBusiness: vi.fn(),
        loadSequences: vi.fn(),
    } as any;
}

describe('Pipeline', () => {
    let pipeline: Pipeline;
    let mockLeadRepo: ReturnType<typeof createMockLeadRepo>;

    beforeEach(() => {
        mockLeadRepo = createMockLeadRepo();
        pipeline = new Pipeline(mockLeadRepo as any, createMockConfig());
    });

    describe('canTransition()', () => {
        it('should allow valid transitions', () => {
            expect(pipeline.canTransition('discovered', 'enriched')).toBe(true);
            expect(pipeline.canTransition('enriched', 'qualified')).toBe(true);
            expect(pipeline.canTransition('qualified', 'contacted')).toBe(true);
            expect(pipeline.canTransition('contacted', 'replied')).toBe(true);
            expect(pipeline.canTransition('replied', 'meeting_booked')).toBe(true);
        });

        it('should reject invalid transitions', () => {
            expect(pipeline.canTransition('discovered', 'contacted')).toBe(false);
            expect(pipeline.canTransition('discovered', 'closed_won')).toBe(false);
            expect(pipeline.canTransition('enriched', 'replied')).toBe(false);
        });

        it('should not allow transitions from terminal states', () => {
            expect(pipeline.canTransition('closed_won', 'contacted')).toBe(false);
            expect(pipeline.canTransition('closed_won', 'discovered')).toBe(false);
        });

        it('should allow re-engagement from closed_lost', () => {
            expect(pipeline.canTransition('closed_lost', 'contacted')).toBe(true);
        });

        it('should allow disqualification from most states', () => {
            expect(pipeline.canTransition('discovered', 'disqualified')).toBe(true);
            expect(pipeline.canTransition('enriched', 'disqualified')).toBe(true);
            expect(pipeline.canTransition('qualified', 'disqualified')).toBe(true);
            expect(pipeline.canTransition('contacted', 'disqualified')).toBe(true);
        });

        it('should allow pausing active leads', () => {
            expect(pipeline.canTransition('qualified', 'paused')).toBe(true);
            expect(pipeline.canTransition('contacted', 'paused')).toBe(true);
        });

        it('should allow resuming paused leads', () => {
            expect(pipeline.canTransition('paused', 'contacted')).toBe(true);
            expect(pipeline.canTransition('paused', 'qualified')).toBe(true);
        });
    });

    describe('transition()', () => {
        it('should transition lead to new state', async () => {
            const lead = await mockLeadRepo.create({
                id: 'lead_1',
                state: 'discovered',
            });

            const updated = await pipeline.transition('lead_1', 'enriched', 'Test reason');
            expect(updated).not.toBeNull();
            expect(updated?.state).toBe('enriched');
        });

        it('should add reason to notes', async () => {
            await mockLeadRepo.create({ id: 'lead_2', state: 'discovered' });
            await pipeline.transition('lead_2', 'enriched', 'Enrichment complete');

            expect(mockLeadRepo.update).toHaveBeenCalledWith(
                'lead_2',
                expect.objectContaining({
                    state: 'enriched',
                })
            );
        });

        it('should return null for invalid transition', async () => {
            await mockLeadRepo.create({ id: 'lead_3', state: 'discovered' });
            const result = await pipeline.transition('lead_3', 'closed_won');
            expect(result).toBeNull();
        });

        it('should return null for non-existent lead', async () => {
            const result = await pipeline.transition('nonexistent', 'enriched');
            expect(result).toBeNull();
        });
    });

    describe('process()', () => {
        it('should create lead on LEAD_DISCOVERED event', async () => {
            await pipeline.process({
                type: 'LEAD_DISCOVERED',
                payload: { firstName: 'John', companyName: 'Acme' },
                timestamp: new Date(),
            } as PipelineEvent);

            expect(mockLeadRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ firstName: 'John', companyName: 'Acme' })
            );
        });

        it('should enrich lead on LEAD_ENRICHED event', async () => {
            const lead = await mockLeadRepo.create({
                id: 'lead_enrich',
                state: 'discovered',
            });

            await pipeline.process({
                type: 'LEAD_ENRICHED',
                payload: { leadId: 'lead_enrich', data: { industry: 'Tech' } },
                timestamp: new Date(),
            } as PipelineEvent);

            expect(mockLeadRepo.update).toHaveBeenCalledWith(
                'lead_enrich',
                expect.objectContaining({ industry: 'Tech' })
            );
        });

        it('should transition on LEAD_QUALIFIED event', async () => {
            await mockLeadRepo.create({
                id: 'lead_qual',
                state: 'enriched',
            });

            await pipeline.process({
                type: 'LEAD_QUALIFIED',
                payload: { leadId: 'lead_qual', score: 85 },
                timestamp: new Date(),
            } as PipelineEvent);

            expect(mockLeadRepo.update).toHaveBeenCalledWith(
                'lead_qual',
                expect.objectContaining({ score: 85 })
            );
        });

        it('should handle MESSAGE_SENT event', async () => {
            await mockLeadRepo.create({
                id: 'lead_msg',
                state: 'qualified',
            });

            await pipeline.process({
                type: 'MESSAGE_SENT',
                payload: {
                    leadId: 'lead_msg',
                    message: {
                        id: 'msg_test_1',
                        content: 'Hello!',
                        channel: 'whatsapp',
                        direction: 'outbound',
                        timestamp: new Date(),
                    },
                },
                timestamp: new Date(),
            } as PipelineEvent);

            expect(mockLeadRepo.addMessage).toHaveBeenCalledWith(
                'lead_msg',
                expect.objectContaining({ content: 'Hello!' })
            );
        });
    });

    describe('event handlers', () => {
        it('should call registered event handlers', async () => {
            const handler = vi.fn();
            pipeline.on('LEAD_DISCOVERED', handler);

            const event: PipelineEvent = {
                type: 'LEAD_DISCOVERED',
                payload: { firstName: 'Jane' },
                timestamp: new Date(),
            } as PipelineEvent;

            await pipeline.process(event);

            expect(handler).toHaveBeenCalledWith(event);
        });

        it('should support multiple handlers for same event', async () => {
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            pipeline.on('LEAD_DISCOVERED', handler1);
            pipeline.on('LEAD_DISCOVERED', handler2);

            await pipeline.process({
                type: 'LEAD_DISCOVERED',
                payload: {},
                timestamp: new Date(),
            } as PipelineEvent);

            expect(handler1).toHaveBeenCalled();
            expect(handler2).toHaveBeenCalled();
        });
    });
});
