import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import { leads } from './leads.js';
import { outreach } from './outreach.js';
import { sources, runSource } from './sources.js';
import { config } from './config.js';

const app = new Hono();

// Middleware
app.use('*', cors());

// API Routes
app.get('/api/stats', async (c) => {
    await leads.connect();
    const stats = await leads.getStats();
    return c.json(stats);
});

app.get('/api/leads', async (c) => {
    await leads.connect();
    const state = c.req.query('state');
    const source = c.req.query('source');
    const search = c.req.query('search')?.toLowerCase();

    let allLeads = await leads.getAll();

    // Filter by state
    if (state && state !== 'all') {
        allLeads = allLeads.filter(l => l.state === state);
    }

    // Filter by source
    if (source && source !== 'all') {
        allLeads = allLeads.filter(l => l.source === source);
    }

    // Search filter
    if (search) {
        allLeads = allLeads.filter(l =>
            l.companyName?.toLowerCase().includes(search) ||
            l.firstName?.toLowerCase().includes(search) ||
            l.lastName?.toLowerCase().includes(search) ||
            l.email?.toLowerCase().includes(search) ||
            l.phone?.includes(search)
        );
    }

    // Sort by createdAt descending
    allLeads.sort((a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    return c.json({
        leads: allLeads,
        total: allLeads.length
    });
});

app.get('/api/leads/:id', async (c) => {
    await leads.connect();
    const lead = await leads.get(c.req.param('id'));
    if (!lead) {
        return c.json({ error: 'Lead not found' }, 404);
    }
    return c.json(lead);
});

// Create new lead
app.post('/api/leads', async (c) => {
    await leads.connect();
    const data = await c.req.json();

    const newLead = await leads.create({
        companyName: data.companyName || 'Unknown',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || '',
        phone: data.phone || '',
        website: data.website || '',
        whatsappNumber: data.whatsappNumber || '',
        state: data.state || 'discovered',
        source: data.source || 'manual',
        tags: data.tags || [],
        // Qualification fields
        industry: data.industry,
        companySize: data.companySize,
        signalSummary: data.signalSummary,
        recentActivity: data.recentActivity,
        painPoint: data.painPoint,
        linkedinUrl: data.linkedinUrl,
    });

    return c.json(newLead, 201);
});

app.put('/api/leads/:id', async (c) => {
    await leads.connect();
    const updates = await c.req.json();
    const lead = await leads.update(c.req.param('id'), updates);
    if (!lead) {
        return c.json({ error: 'Lead not found' }, 404);
    }
    return c.json(lead);
});

app.delete('/api/leads/:id', async (c) => {
    await leads.connect();
    const deleted = await leads.delete(c.req.param('id'));
    return c.json({ success: deleted });
});

// Bulk update leads
app.post('/api/leads/bulk-update', async (c) => {
    await leads.connect();
    const { ids, updates } = await c.req.json();

    const results = await Promise.all(
        ids.map((id: string) => leads.update(id, updates))
    );

    return c.json({
        success: true,
        updated: results.filter(Boolean).length
    });
});

// Export leads as CSV
app.get('/api/export', async (c) => {
    await leads.connect();
    const allLeads = await leads.getAll();

    const headers = ['Company', 'Contact', 'Email', 'Phone', 'Website', 'Source', 'State'];
    const rows = allLeads.map(l => [
        l.companyName || '',
        `${l.firstName || ''} ${l.lastName || ''}`.trim(),
        l.email || '',
        l.phone || l.whatsappNumber || '',
        l.website || '',
        l.source || '',
        l.state || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', 'attachment; filename="leads.csv"');
    return c.body(csv);
});

// Outreach: Start sequence for a lead
app.post('/api/outreach/start/:id', async (c) => {
    await leads.connect();
    const leadId = c.req.param('id');
    const { sequence } = await c.req.json().catch(() => ({ sequence: 'default' }));

    const success = await outreach.startSequence(leadId, sequence);
    return c.json({ success, leadId, sequence });
});

// Outreach: Execute next step for a lead
app.post('/api/outreach/send/:id', async (c) => {
    await leads.connect();
    const leadId = c.req.param('id');

    const result = await outreach.executeStep(leadId);
    return c.json(result);
});

// Outreach: Process all ready leads
app.post('/api/outreach/process', async (c) => {
    await leads.connect();
    const result = await outreach.processReadyLeads();
    return c.json(result);
});

// Channel status - check which channels are ready
app.get('/api/channels/status', async (c) => {
    const { messenger } = await import('./channels/index.js');
    const status = await messenger.getChannelStatus();
    return c.json(status);
});

// Get available sequences
app.get('/api/sequences', async (c) => {
    try {
        const { config } = await import('./config.js');
        const sequences = config.loadSequences();
        return c.json(sequences);
    } catch (err) {
        return c.json({ sequences: [], error: 'No sequences configured' });
    }
});

// Add note to lead
app.post('/api/leads/:id/notes', async (c) => {
    await leads.connect();
    const { note } = await c.req.json();
    const lead = await leads.get(c.req.param('id'));

    if (!lead) {
        return c.json({ error: 'Lead not found' }, 404);
    }

    const notes = lead.notes || [];
    notes.push(`[${new Date().toISOString()}] ${note}`);

    const updated = await leads.update(c.req.param('id'), { notes });
    return c.json(updated);
});

// Lead activity/history
app.get('/api/leads/:id/activity', async (c) => {
    await leads.connect();
    const lead = await leads.get(c.req.param('id'));

    if (!lead) {
        return c.json({ error: 'Lead not found' }, 404);
    }

    // Build activity from lead data
    const activity = [];

    if (lead.createdAt) {
        activity.push({ type: 'created', date: lead.createdAt, note: 'Lead discovered' });
    }

    if (lead.conversationHistory?.length) {
        for (const msg of lead.conversationHistory) {
            activity.push({ type: 'message', date: msg.timestamp, note: `${msg.channel}: ${msg.content?.slice(0, 50)}...` });
        }
    }

    if (lead.notes?.length) {
        for (const note of lead.notes) {
            const match = note.match(/^\[(.+?)\] (.+)$/);
            if (match) {
                activity.push({ type: 'note', date: match[1], note: match[2] });
            }
        }
    }

    return c.json({ activity: activity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) });
});

// =====================================================
// SOURCES API
// =====================================================

// List all sources
app.get('/api/sources', async (c) => {
    await sources.connect();
    const allSources = await sources.getAll();
    return c.json({ sources: allSources });
});

// Get single source
app.get('/api/sources/:id', async (c) => {
    await sources.connect();
    const source = await sources.get(c.req.param('id'));
    if (!source) {
        return c.json({ error: 'Source not found' }, 404);
    }
    return c.json(source);
});

// Create new source
app.post('/api/sources', async (c) => {
    await sources.connect();
    const data = await c.req.json();

    const newSource = await sources.create({
        name: data.name,
        type: data.type,
        config: data.config || {},
        schedule: data.schedule || 'manual',
        status: data.status || 'active'
    });

    return c.json(newSource, 201);
});

// Update source
app.put('/api/sources/:id', async (c) => {
    await sources.connect();
    const updates = await c.req.json();
    const source = await sources.update(c.req.param('id'), updates);
    if (!source) {
        return c.json({ error: 'Source not found' }, 404);
    }
    return c.json(source);
});

// Delete source
app.delete('/api/sources/:id', async (c) => {
    await sources.connect();
    const deleted = await sources.delete(c.req.param('id'));
    return c.json({ success: deleted });
});

// Run source scraper
app.post('/api/sources/:id/run', async (c) => {
    await sources.connect();
    const sourceId = c.req.param('id');
    const source = await sources.get(sourceId);

    if (!source) {
        return c.json({ error: 'Source not found' }, 404);
    }

    // Get headless option from query (default true, set false for CAPTCHA solving)
    const headless = c.req.query('headless') !== 'false';

    console.log(`[SERVER] Running source: ${source.name} (headless: ${headless})`);

    const result = await runSource(source, headless);

    // Update source stats
    await sources.updateStats(sourceId, result.leadsAdded, result.error);

    return c.json({
        success: result.success,
        leadsAdded: result.leadsAdded,
        error: result.error
    });
});

// =====================================================
// AUTOMATION API
// =====================================================

import { automation } from './automation.js';

// Get automation status
app.get('/api/automation/status', async (c) => {
    const status = await automation.getStatus();
    return c.json(status);
});

// Run a single automation cycle
app.post('/api/automation/run-cycle', async (c) => {
    await leads.connect();
    const result = await automation.runCycle();
    return c.json(result);
});

// Start automated cycling
app.post('/api/automation/start', async (c) => {
    const { intervalMinutes } = await c.req.json().catch(() => ({ intervalMinutes: 60 }));
    automation.start(intervalMinutes);
    const status = await automation.getStatus();
    return c.json({ success: true, ...status });
});

// Stop automated cycling
app.post('/api/automation/stop', async (c) => {
    automation.stop();
    const status = await automation.getStatus();
    return c.json({ success: true, ...status });
});

// =====================================================
// DASHBOARD OVERVIEW
// =====================================================

app.get('/api/dashboard', async (c) => {
    await leads.connect();
    const stats = await leads.getStats();
    const allLeads = await leads.getAll();
    const recentLeads = allLeads
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 10);
    return c.json({ stats, recentLeads, totalLeads: allLeads.length });
});

// =====================================================
// LEAD STATE / BULK OPS
// =====================================================

// Update lead state
app.put('/api/leads/:id/state', async (c) => {
    await leads.connect();
    const { state } = await c.req.json();
    const lead = await leads.update(c.req.param('id'), { state });
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    return c.json(lead);
});

// Enrich lead (trigger re-qualification)
app.post('/api/leads/:id/enrich', async (c) => {
    await leads.connect();
    const { qualifier } = await import('./qualifier.js');
    const lead = await leads.get(c.req.param('id'));
    if (!lead) return c.json({ error: 'Lead not found' }, 404);
    const result = qualifier.qualify(lead);
    await leads.update(c.req.param('id'), {
        score: result.score,
        signalSummary: qualifier.generateSignalSummary(result.matchedSignals),
        state: result.qualified ? 'qualified' : lead.state,
    });
    return c.json({ success: true, score: result.score, qualified: result.qualified });
});

// Start sequence for lead
app.post('/api/leads/:id/sequence', async (c) => {
    await leads.connect();
    const { sequence } = await c.req.json().catch(() => ({ sequence: 'cold_outreach' }));
    const success = await outreach.startSequence(c.req.param('id'), sequence);
    return c.json({ success });
});

// Bulk state update
app.post('/api/leads/bulk/state', async (c) => {
    await leads.connect();
    const { ids, state } = await c.req.json();
    const results = await Promise.all(ids.map((id: string) => leads.update(id, { state })));
    return c.json({ success: true, updated: results.filter(Boolean).length });
});

// Bulk delete
app.post('/api/leads/bulk/delete', async (c) => {
    await leads.connect();
    const { ids } = await c.req.json();
    const results = await Promise.all(ids.map((id: string) => leads.delete(id)));
    return c.json({ success: true, deleted: results.filter(Boolean).length });
});

// Bulk tags
app.post('/api/leads/bulk/tags', async (c) => {
    await leads.connect();
    const { ids, tags } = await c.req.json();
    const results = await Promise.all(ids.map(async (id: string) => {
        const lead = await leads.get(id);
        if (!lead) return false;
        const mergedTags = [...new Set([...(lead.tags || []), ...tags])];
        return leads.update(id, { tags: mergedTags });
    }));
    return c.json({ success: true, updated: results.filter(Boolean).length });
});

// =====================================================
// SCRAPERS API
// =====================================================

import { listScrapers, runScraper, getScraperStatus, stopScraper } from './scraper-registry.js';

app.get('/api/scrapers', (c) => {
    return c.json({ scrapers: listScrapers() });
});

app.post('/api/scrapers/:name/run', async (c) => {
    const params = await c.req.json().catch(() => ({}));
    const result = runScraper(c.req.param('name'), params);
    return c.json(result);
});

app.get('/api/scrapers/:runId/status', (c) => {
    const status = getScraperStatus(c.req.param('runId'));
    if (!status) return c.json({ error: 'Run not found' }, 404);
    return c.json(status);
});

app.post('/api/scrapers/stop/:runId', (c) => {
    const stopped = stopScraper(c.req.param('runId'));
    return c.json({ success: stopped });
});

// =====================================================
// WHATSAPP API
// =====================================================

import { whatsapp } from './channels/whatsapp.js';

app.get('/api/whatsapp/status', async (c) => {
    const ready = await whatsapp.isReady();
    const qr = whatsapp.getQR?.() || null;
    return c.json({
        connected: ready,
        status: ready ? 'connected' : (qr ? 'awaiting_scan' : 'disconnected'),
        qr,
    });
});

app.post('/api/whatsapp/connect', async (c) => {
    const connected = await whatsapp.connect();
    await new Promise(resolve => setTimeout(resolve, 2000));
    const qr = whatsapp.getQR?.() || null;
    return c.json({
        success: connected || !!qr,
        status: connected ? 'connected' : (qr ? 'awaiting_scan' : 'connecting'),
        qr,
    });
});

app.get('/api/whatsapp/qr', (c) => {
    const qr = whatsapp.getQR?.() || null;
    return c.json({ qr });
});

app.get('/api/whatsapp/conversations', async (c) => {
    const { whatsappMessages } = await import('./whatsapp-messages.js');
    const conversations = whatsappMessages.getConversations();
    return c.json({ conversations });
});

app.get('/api/whatsapp/messages/:jid', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const { whatsappMessages } = await import('./whatsapp-messages.js');
    const messages = whatsappMessages.getMessages(jid);
    return c.json({ messages });
});

app.post('/api/whatsapp/reply/:jid', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const { message } = await c.req.json();
    const result = await whatsapp.sendToJid(jid, message);
    return c.json(result);
});

app.post('/api/whatsapp/media/:jid', async (c) => {
    const jid = decodeURIComponent(c.req.param('jid'));
    const body = await c.req.json();
    try {
        const mediaBuffer = Buffer.from(body.data || '', 'base64');
        const result = await whatsapp.sendMediaToJid(jid, mediaBuffer, {
            mimetype: body.mimetype || 'image/jpeg',
            filename: body.filename,
            caption: body.caption,
        });
        return c.json(result);
    } catch (err) {
        return c.json({ success: false, error: err instanceof Error ? err.message : 'Media send failed' });
    }
});

// =====================================================
// TELEGRAM API
// =====================================================

app.get('/api/telegram/status', async (c) => {
    const { telegram } = await import('./channels/telegram.js');
    const ready = await telegram.isReady();
    return c.json({ connected: ready, status: ready ? 'connected' : 'disconnected' });
});

// =====================================================
// TEMPLATES API
// =====================================================

app.get('/api/templates', async (c) => {
    try {
        const sequences = config.loadSequences();
        // Extract templates from sequences
        const templates: { id: string; name: string; content: string; sequence: string }[] = [];
        if (sequences.sequences) {
            for (const [seqName, seq] of Object.entries(sequences.sequences)) {
                for (const step of (seq as any).steps || []) {
                    if (step.template) {
                        templates.push({
                            id: `${seqName}_${step.id}`,
                            name: `${seqName} — ${step.id}`,
                            content: step.template,
                            sequence: seqName,
                        });
                    }
                }
            }
        }
        return c.json({ templates });
    } catch {
        return c.json({ templates: [] });
    }
});

// Serve static files
app.use('/*', serveStatic({ root: './public' }));

// Start server
const port = parseInt(process.env.PORT || '3000', 10);
console.log(`🚀 CRM Dashboard running at http://localhost:${port}`);

serve({
    fetch: app.fetch,
    port
});
