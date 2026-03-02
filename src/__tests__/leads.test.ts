/**
 * LeadRepository Unit Tests
 * Tests CRUD operations using a real Redis connection
 * 
 * Requirements: Redis must be running on localhost:6379
 * We use a test-specific prefix to avoid interfering with production data
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LeadRepository } from '../leads.js';

describe('LeadRepository', () => {
    let repo: LeadRepository;
    const createdIds: string[] = [];

    beforeAll(async () => {
        repo = new LeadRepository();
        await repo.connect();
    });

    afterAll(async () => {
        // Cleanup test data
        for (const id of createdIds) {
            try {
                await repo.delete(id);
            } catch { }
        }
        await repo.disconnect();
    });

    describe('create()', () => {
        it('should create a lead with default values', async () => {
            const lead = await repo.create({
                firstName: 'TestUser',
                companyName: 'TestCorp',
            });

            createdIds.push(lead.id);

            expect(lead.id).toMatch(/^lead_/);
            expect(lead.firstName).toBe('TestUser');
            expect(lead.companyName).toBe('TestCorp');
            expect(lead.state).toBe('discovered');
            expect(lead.score).toBe(0);
            expect(lead.source).toBe('manual');
            expect(lead.contactAttempts).toBe(0);
            expect(lead.conversationHistory).toEqual([]);
            expect(lead.tags).toEqual([]);
            expect(lead.notes).toEqual([]);
            expect(lead.createdAt).toBeInstanceOf(Date);
            expect(lead.updatedAt).toBeInstanceOf(Date);
        });

        it('should create a lead with custom values', async () => {
            const lead = await repo.create({
                firstName: 'Custom',
                companyName: 'CustomCorp',
                phone: '+77771234567',
                email: 'test@custom.com',
                state: 'qualified',
                source: 'scrape',
                score: 85,
                tags: ['education', 'almaty'],
            });

            createdIds.push(lead.id);

            expect(lead.firstName).toBe('Custom');
            expect(lead.phone).toBe('+77771234567');
            expect(lead.email).toBe('test@custom.com');
            expect(lead.state).toBe('qualified');
            expect(lead.source).toBe('scrape');
            expect(lead.score).toBe(85);
            expect(lead.tags).toEqual(['education', 'almaty']);
        });

        it('should generate unique IDs', async () => {
            const lead1 = await repo.create({ firstName: 'A' });
            const lead2 = await repo.create({ firstName: 'B' });

            createdIds.push(lead1.id, lead2.id);

            expect(lead1.id).not.toBe(lead2.id);
        });
    });

    describe('get()', () => {
        it('should retrieve a lead by ID', async () => {
            const created = await repo.create({
                firstName: 'GetTest',
                companyName: 'GetCorp',
                email: 'get@test.com',
            });
            createdIds.push(created.id);

            const retrieved = await repo.get(created.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.firstName).toBe('GetTest');
            expect(retrieved!.companyName).toBe('GetCorp');
            expect(retrieved!.email).toBe('get@test.com');
        });

        it('should return null for non-existent ID', async () => {
            const result = await repo.get('nonexistent_lead_xyz');
            expect(result).toBeNull();
        });

        it('should parse dates correctly', async () => {
            const created = await repo.create({ firstName: 'DateTest' });
            createdIds.push(created.id);

            const retrieved = await repo.get(created.id);
            expect(retrieved!.createdAt).toBeInstanceOf(Date);
            expect(retrieved!.updatedAt).toBeInstanceOf(Date);
        });
    });

    describe('update()', () => {
        it('should update lead fields', async () => {
            const created = await repo.create({
                firstName: 'UpdateMe',
                companyName: 'OldCorp',
            });
            createdIds.push(created.id);

            const updated = await repo.update(created.id, {
                companyName: 'NewCorp',
                score: 50,
            });

            expect(updated).not.toBeNull();
            expect(updated!.companyName).toBe('NewCorp');
            expect(updated!.score).toBe(50);
            expect(updated!.firstName).toBe('UpdateMe'); // Unchanged
        });

        it('should update updatedAt timestamp', async () => {
            const created = await repo.create({ firstName: 'TimeTest' });
            createdIds.push(created.id);

            // Small delay to ensure different timestamp
            await new Promise(r => setTimeout(r, 10));

            const updated = await repo.update(created.id, { score: 99 });
            expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
        });

        it('should return null for non-existent lead', async () => {
            const result = await repo.update('nonexistent_xyz', { score: 100 });
            expect(result).toBeNull();
        });
    });

    describe('delete()', () => {
        it('should delete a lead', async () => {
            const created = await repo.create({ firstName: 'DeleteMe' });

            const deleted = await repo.delete(created.id);
            expect(deleted).toBe(true);

            const retrieved = await repo.get(created.id);
            expect(retrieved).toBeNull();
        });

        it('should return false for non-existent lead', async () => {
            const result = await repo.delete('nonexistent_del');
            expect(result).toBe(false);
        });
    });

    describe('getStats()', () => {
        it('should return correct stat structure', async () => {
            const stats = await repo.getStats();
            expect(stats).toHaveProperty('total');
            expect(stats).toHaveProperty('byState');
            expect(stats).toHaveProperty('bySource');
            expect(typeof stats.total).toBe('number');
        });
    });

    describe('findByCompany()', () => {
        it('should find lead by company name (case insensitive)', async () => {
            const created = await repo.create({
                firstName: 'FindMe',
                companyName: 'UniqueCompanyXYZ123',
            });
            createdIds.push(created.id);

            const found = await repo.findByCompany('uniquecompanyxyz123');
            expect(found).not.toBeNull();
            expect(found!.firstName).toBe('FindMe');
        });

        it('should return null for non-existent company', async () => {
            const found = await repo.findByCompany('NoSuchCompany999');
            expect(found).toBeNull();
        });
    });

    describe('existsByEmail()', () => {
        it('should detect existing email', async () => {
            const created = await repo.create({
                firstName: 'EmailTest',
                email: 'unique_test_email@example.com',
            });
            createdIds.push(created.id);

            const exists = await repo.existsByEmail('unique_test_email@example.com');
            expect(exists).toBe(true);
        });

        it('should be case insensitive', async () => {
            const created = await repo.create({
                firstName: 'CaseTest',
                email: 'CaseTest@Example.COM',
            });
            createdIds.push(created.id);

            const exists = await repo.existsByEmail('casetest@example.com');
            expect(exists).toBe(true);
        });
    });

    describe('existsByPhone()', () => {
        it('should detect existing phone (normalized)', async () => {
            const created = await repo.create({
                firstName: 'PhoneTest',
                phone: '+7 (777) 123-45-67',
            });
            createdIds.push(created.id);

            const exists = await repo.existsByPhone('77771234567');
            expect(exists).toBe(true);
        });
    });
});
