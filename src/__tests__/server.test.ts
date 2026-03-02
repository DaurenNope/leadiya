/**
 * Server API Integration Tests
 * Tests Hono API endpoints using app.request() (no HTTP server needed)
 * 
 * These tests use real Redis and validate the full request/response cycle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LeadRepository } from '../leads.js';

// We build a minimal test Hono app that mirrors server.ts routes
// instead of importing server.ts (which has side-effects: starts listening)
const repo = new LeadRepository();

const app = new Hono();
app.use('*', cors());

// Mirror the core server routes using our test repo
app.get('/api/stats', async (c) => {
    await repo.connect();
    const stats = await repo.getStats();
    return c.json(stats);
});

app.get('/api/leads', async (c) => {
    await repo.connect();
    const state = c.req.query('state');
    const source = c.req.query('source');
    const search = c.req.query('search')?.toLowerCase();

    let allLeads = await repo.getAll();

    if (state && state !== 'all') {
        allLeads = allLeads.filter(l => l.state === state);
    }
    if (source && source !== 'all') {
        allLeads = allLeads.filter(l => l.source === source);
    }
    if (search) {
        allLeads = allLeads.filter(l =>
            l.companyName?.toLowerCase().includes(search) ||
            l.firstName?.toLowerCase().includes(search) ||
            l.email?.toLowerCase().includes(search)
        );
    }

    allLeads.sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    return c.json({ leads: allLeads, total: allLeads.length });
});

app.get('/api/leads/:id', async (c) => {
    await repo.connect();
    const lead = await repo.get(c.req.param('id'));
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    return c.json(lead);
});

app.post('/api/leads', async (c) => {
    await repo.connect();
    const data = await c.req.json();
    const newLead = await repo.create({
        companyName: data.companyName || 'Unknown',
        firstName: data.firstName || '',
        email: data.email || '',
        phone: data.phone || '',
        state: data.state || 'discovered',
        source: data.source || 'manual',
        tags: data.tags || [],
    });
    return c.json(newLead, 201);
});

app.put('/api/leads/:id', async (c) => {
    await repo.connect();
    const updates = await c.req.json();
    const lead = await repo.update(c.req.param('id'), updates);
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    return c.json(lead);
});

app.delete('/api/leads/:id', async (c) => {
    await repo.connect();
    const deleted = await repo.delete(c.req.param('id'));
    return c.json({ success: deleted });
});

app.post('/api/leads/bulk-update', async (c) => {
    await repo.connect();
    const { ids, updates } = await c.req.json();
    const results = await Promise.all(
        ids.map((id: string) => repo.update(id, updates))
    );
    return c.json({ success: true, updated: results.filter(Boolean).length });
});

app.get('/api/export', async (c) => {
    await repo.connect();
    const allLeads = await repo.getAll();
    const headers = ['Company', 'Contact', 'Email', 'Phone', 'Website', 'Source', 'State'];
    const rows = allLeads.map(l => [
        l.companyName || '',
        `${l.firstName || ''} ${l.lastName || ''}`.trim(),
        l.email || '',
        l.phone || '',
        l.website || '',
        l.source || '',
        l.state || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    c.header('Content-Type', 'text/csv');
    return c.body(csv);
});

app.post('/api/leads/:id/notes', async (c) => {
    await repo.connect();
    const { note } = await c.req.json();
    const lead = await repo.get(c.req.param('id'));
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    const notes = lead.notes || [];
    notes.push(`[${new Date().toISOString()}] ${note}`);
    const updated = await repo.update(c.req.param('id'), { notes });
    return c.json(updated);
});

app.get('/api/leads/:id/activity', async (c) => {
    await repo.connect();
    const lead = await repo.get(c.req.param('id'));
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    const activity: any[] = [];
    if (lead.createdAt) {
        activity.push({ type: 'created', date: lead.createdAt, note: 'Lead discovered' });
    }
    return c.json({ activity });
});

// ====== TESTS ======

const createdIds: string[] = [];

describe('Server API', () => {
    beforeAll(async () => {
        await repo.connect();
    });

    afterAll(async () => {
        for (const id of createdIds) {
            try { await repo.delete(id); } catch { }
        }
        await repo.disconnect();
    });

    // Helper to make requests
    const req = (method: string, path: string, body?: any) => {
        const opts: RequestInit = { method };
        if (body) {
            opts.body = JSON.stringify(body);
            opts.headers = { 'Content-Type': 'application/json' };
        }
        return app.request(path, opts);
    };

    // --- CRUD ---

    describe('POST /api/leads', () => {
        it('should create a lead and return 201', async () => {
            const res = await req('POST', '/api/leads', {
                firstName: 'IntegTest',
                companyName: 'IntegCorp',
                email: 'integ@test.com',
            });

            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.id).toMatch(/^lead_/);
            expect(data.firstName).toBe('IntegTest');
            expect(data.companyName).toBe('IntegCorp');
            expect(data.state).toBe('discovered');

            createdIds.push(data.id);
        });

        it('should default state to discovered', async () => {
            const res = await req('POST', '/api/leads', { companyName: 'DefaultState' });
            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.state).toBe('discovered');
            createdIds.push(data.id);
        });
    });

    describe('GET /api/leads/:id', () => {
        it('should return a lead by ID', async () => {
            const createRes = await req('POST', '/api/leads', {
                firstName: 'GetById',
                companyName: 'GetByIdCorp',
            });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('GET', `/api/leads/${created.id}`);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.firstName).toBe('GetById');
        });

        it('should return 404 for non-existent lead', async () => {
            const res = await req('GET', '/api/leads/nonexistent_xyz_999');
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error).toBe('Lead not found');
        });
    });

    describe('PUT /api/leads/:id', () => {
        it('should update lead fields', async () => {
            const createRes = await req('POST', '/api/leads', {
                firstName: 'UpdateViaAPI',
                companyName: 'BeforeUpdateCorp',
            });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('PUT', `/api/leads/${created.id}`, {
                companyName: 'AfterUpdateCorp',
                score: 75,
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.companyName).toBe('AfterUpdateCorp');
            expect(data.score).toBe(75);
        });

        it('should return 404 for non-existent lead', async () => {
            const res = await req('PUT', '/api/leads/nonexistent_xyz_999', {
                score: 100,
            });
            expect(res.status).toBe(404);
        });
    });

    describe('DELETE /api/leads/:id', () => {
        it('should delete a lead', async () => {
            const createRes = await req('POST', '/api/leads', {
                firstName: 'DeleteViaAPI',
            });
            const created = await createRes.json();

            const res = await req('DELETE', `/api/leads/${created.id}`);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);

            // Verify it's gone
            const getRes = await req('GET', `/api/leads/${created.id}`);
            expect(getRes.status).toBe(404);
        });
    });

    // --- LIST & FILTER ---

    describe('GET /api/leads', () => {
        it('should return leads list with total', async () => {
            const res = await req('GET', '/api/leads');
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data).toHaveProperty('leads');
            expect(data).toHaveProperty('total');
            expect(Array.isArray(data.leads)).toBe(true);
        });

        it('should filter by state', async () => {
            const createRes = await req('POST', '/api/leads', {
                firstName: 'StateFilter',
                companyName: 'StateFilterCorp',
                state: 'qualified',
            });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('GET', '/api/leads?state=qualified');
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.leads.every((l: any) => l.state === 'qualified')).toBe(true);
        });

        it('should filter by source', async () => {
            const createRes = await req('POST', '/api/leads', {
                firstName: 'SourceFilter',
                source: 'scrape',
            });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('GET', '/api/leads?source=scrape');
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.leads.every((l: any) => l.source === 'scrape')).toBe(true);
        });

        it('should search by company name', async () => {
            const unique = 'UniqueCompanySearchTest_' + Date.now();
            const createRes = await req('POST', '/api/leads', {
                firstName: 'SearchMe',
                companyName: unique,
            });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('GET', `/api/leads?search=${unique.toLowerCase()}`);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.leads.length).toBeGreaterThanOrEqual(1);
            expect(data.leads[0].companyName).toBe(unique);
        });
    });

    // --- STATS ---

    describe('GET /api/stats', () => {
        it('should return stats with correct structure', async () => {
            const res = await req('GET', '/api/stats');
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data).toHaveProperty('total');
            expect(data).toHaveProperty('byState');
            expect(data).toHaveProperty('bySource');
            expect(typeof data.total).toBe('number');
        });
    });

    // --- BULK ---

    describe('POST /api/leads/bulk-update', () => {
        it('should update multiple leads at once', async () => {
            const res1 = await req('POST', '/api/leads', { firstName: 'Bulk1' });
            const res2 = await req('POST', '/api/leads', { firstName: 'Bulk2' });
            const l1 = await res1.json();
            const l2 = await res2.json();
            createdIds.push(l1.id, l2.id);

            const bulkRes = await req('POST', '/api/leads/bulk-update', {
                ids: [l1.id, l2.id],
                updates: { state: 'contacted' },
            });

            expect(bulkRes.status).toBe(200);
            const data = await bulkRes.json();
            expect(data.success).toBe(true);
            expect(data.updated).toBe(2);
        });
    });

    // --- EXPORT ---

    describe('GET /api/export', () => {
        it('should return CSV content', async () => {
            const res = await req('GET', '/api/export');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/csv');

            const csv = await res.text();
            expect(csv).toContain('Company,Contact,Email,Phone,Website,Source,State');
        });
    });

    // --- NOTES ---

    describe('POST /api/leads/:id/notes', () => {
        it('should add a note to a lead', async () => {
            const createRes = await req('POST', '/api/leads', { firstName: 'NoteTest' });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('POST', `/api/leads/${created.id}/notes`, {
                note: 'Test note content',
            });

            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.notes).toHaveLength(1);
            expect(data.notes[0]).toContain('Test note content');
        });

        it('should return 404 for non-existent lead', async () => {
            const res = await req('POST', '/api/leads/nonexistent/notes', {
                note: 'Should fail',
            });
            expect(res.status).toBe(404);
        });
    });

    // --- ACTIVITY ---

    describe('GET /api/leads/:id/activity', () => {
        it('should return activity for a lead', async () => {
            const createRes = await req('POST', '/api/leads', { firstName: 'ActivityTest' });
            const created = await createRes.json();
            createdIds.push(created.id);

            const res = await req('GET', `/api/leads/${created.id}/activity`);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.activity).toBeInstanceOf(Array);
            expect(data.activity.length).toBeGreaterThanOrEqual(1);
            expect(data.activity[0].type).toBe('created');
        });

        it('should return 404 for non-existent lead', async () => {
            const res = await req('GET', '/api/leads/nonexistent/activity');
            expect(res.status).toBe(404);
        });
    });
});
