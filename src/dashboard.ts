/**
 * Dashboard API Server
 * REST API for the CRM dashboard
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { engine, leads } from './index.js';
import type { Lead, LeadState, LeadSource } from './types.js';

const PORT = process.env.DASHBOARD_PORT || 3847;

/**
 * Parse JSON body from request
 */
async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Route handler
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // === DASHBOARD DATA ===
    if (path === '/api/dashboard' && method === 'GET') {
      const summary = await engine.getPipelineSummary();
      const stats = await engine.getStats();
      const allLeads = await engine.listLeads();
      const needsResearch = allLeads.filter((l: any) => l.needsResearch).length;
      json(res, { summary, stats, needsResearch });
      return;
    }

    // === LEADS ===
    if (path === '/api/leads' && method === 'GET') {
      const state = url.searchParams.get('state') as LeadState | null;
      const source = url.searchParams.get('source') as LeadSource | null;
      const leads = await engine.listLeads({
        state: state || undefined,
        source: source || undefined
      });
      json(res, { leads });
      return;
    }

    if (path === '/api/leads' && method === 'POST') {
      const body = await parseBody(req) as Record<string, unknown>;
      const lead = await engine.addLead(body);
      json(res, { lead }, 201);
      return;
    }

    const leadMatch = path.match(/^\/api\/leads\/([a-z0-9_]+)$/);
    if (leadMatch) {
      const leadId = leadMatch[1];

      if (method === 'GET') {
        const lead = await engine.getLead(leadId);
        if (!lead) {
          json(res, { error: 'Lead not found' }, 404);
          return;
        }
        json(res, { lead });
        return;
      }

      if (method === 'PUT') {
        const body = await parseBody(req) as Record<string, unknown>;
        const lead = await engine.updateLead(leadId, body);
        if (!lead) {
          json(res, { error: 'Lead not found' }, 404);
          return;
        }
        json(res, { lead });
        return;
      }

      if (method === 'DELETE') {
        const deleted = await engine.deleteLead(leadId);
        json(res, { deleted });
        return;
      }
    }

    // === LEAD ACTIONS ===
    const actionMatch = path.match(/^\/api\/leads\/([a-z0-9_]+)\/(outreach|qualify|move)$/);
    if (actionMatch && method === 'POST') {
      const [, leadId, action] = actionMatch;
      const body = await parseBody(req) as Record<string, unknown>;

      if (action === 'outreach') {
        const sequence = (body.sequence as string) || 'cold_outreach';
        await engine.startOutreach(leadId, sequence);
        const result = await engine.sendNext(leadId);
        json(res, result);
        return;
      }

      if (action === 'qualify') {
        const result = await engine.requalifyLead(leadId);
        json(res, result);
        return;
      }

      if (action === 'move') {
        const newState = body.state as LeadState;
        const reason = body.reason as string | undefined;
        const lead = await engine.moveLeadState(leadId, newState, reason);
        json(res, { lead });
        return;
      }
    }

    // Lead state update (for drag-and-drop)
    const stateMatch = path.match(/^\/api\/leads\/([a-z0-9_]+)\/state$/);
    if (stateMatch && method === 'PUT') {
      const leadId = stateMatch[1];
      const body = await parseBody(req) as { state: LeadState };

      if (!body.state) {
        json(res, { error: 'State is required' }, 400);
        return;
      }

      const lead = await engine.moveLeadState(leadId, body.state, 'Moved via Kanban');
      json(res, { success: true, lead });
      return;
    }

    // === BULK OPERATIONS ===
    if (path === '/api/outreach/run' && method === 'POST') {
      const result = await engine.runOutreachCycle();
      json(res, result);
      return;
    }

    if (path === '/api/leads/import' && method === 'POST') {
      const body = await parseBody(req) as { leads: Partial<Lead>[] };
      const result = await engine.importLeads(body.leads || []);
      json(res, result);
      return;
    }

    // Bulk update lead states
    if (path === '/api/leads/bulk/state' && method === 'PUT') {
      const body = await parseBody(req) as { ids: string[]; state: LeadState };
      if (!body.ids?.length || !body.state) {
        json(res, { error: 'ids and state required' }, 400);
        return;
      }

      const results = await Promise.all(
        body.ids.map(id => engine.moveLeadState(id, body.state, 'Bulk update'))
      );
      json(res, { success: true, updated: results.length });
      return;
    }

    // Bulk delete leads
    if (path === '/api/leads/bulk/delete' && method === 'POST') {
      const body = await parseBody(req) as { ids: string[] };
      if (!body.ids?.length) {
        json(res, { error: 'ids required' }, 400);
        return;
      }

      const results = await Promise.all(
        body.ids.map(id => engine.deleteLead(id))
      );
      json(res, { success: true, deleted: results.filter(Boolean).length });
      return;
    }

    // Bulk add tags
    if (path === '/api/leads/bulk/tags' && method === 'POST') {
      const body = await parseBody(req) as { ids: string[]; tags: string[] };
      if (!body.ids?.length || !body.tags?.length) {
        json(res, { error: 'ids and tags required' }, 400);
        return;
      }

      const results = await Promise.all(
        body.ids.map(id => engine.addTagsToLead(id, body.tags))
      );
      json(res, { success: true, updated: results.filter(Boolean).length });
      return;
    }

    // Bulk enrich leads
    if (path === '/api/leads/bulk/enrich' && method === 'POST') {
      const { enrichmentService } = await import('./lead-enrichment.js');
      const body = await parseBody(req) as { ids?: string[] };

      // If no IDs provided, enrich all leads
      let leadIds = body.ids;
      if (!leadIds?.length) {
        const allLeads = await engine.listLeads();
        leadIds = allLeads.map(l => l.id);
      }

      const result = await enrichmentService.enrichBatch(leadIds);
      json(res, result);
      return;
    }

    // Single lead enrichment
    const enrichMatch = path.match(/^\/api\/leads\/([a-z0-9_]+)\/enrich$/);
    if (enrichMatch && method === 'POST') {
      const { enrichmentService } = await import('./lead-enrichment.js');
      const leadId = enrichMatch[1];
      const result = await enrichmentService.enrichLead(leadId);
      json(res, result);
      return;
    }

    // === STATS ===
    if (path === '/api/stats' && method === 'GET') {
      const stats = await engine.getStats();
      json(res, stats);
      return;
    }

    // === WHATSAPP API ===
    if (path === '/api/whatsapp/status' && method === 'GET') {
      const status = await engine.getWhatsAppStatus();
      json(res, status);
      return;
    }

    if (path === '/api/whatsapp/qr' && method === 'GET') {
      const { whatsapp } = await import('./channels/whatsapp.js');
      const qr = whatsapp.getQR();
      json(res, { qr, hasQR: !!qr });
      return;
    }

    if (path === '/api/whatsapp/connect' && method === 'POST') {
      const result = await engine.connectWhatsApp();
      json(res, result);
      return;
    }

    if (path === '/api/whatsapp/send' && method === 'POST') {
      const body = await parseBody(req) as { phone: string; message: string };
      const result = await engine.sendWhatsAppMessage(body.phone, body.message);
      json(res, result);
      return;
    }

    // Reply to specific conversation (used by chat UI)
    if (path.startsWith('/api/whatsapp/reply/') && method === 'POST') {
      const phone = decodeURIComponent(path.replace('/api/whatsapp/reply/', ''));
      const body = await parseBody(req) as { message: string };
      const result = await engine.sendWhatsAppMessage(phone, body.message);
      json(res, result);
      return;
    }

    // === TELEGRAM API ===
    if (path === '/api/telegram/status' && method === 'GET') {
      const { telegram } = await import('./channels/telegram.js');
      const ready = await telegram.isReady();
      json(res, {
        connected: ready,
        status: ready ? 'connected' : 'disconnected',
        botUsername: telegram.getBotUsername()
      });
      return;
    }

    if (path === '/api/telegram/connect' && method === 'POST') {
      const { telegram } = await import('./channels/telegram.js');
      const success = await telegram.connect();
      json(res, {
        success,
        message: success ? 'Connected' : 'Failed to connect (check TELEGRAM_BOT_TOKEN)',
        botUsername: telegram.getBotUsername()
      });
      return;
    }

    if (path === '/api/telegram/send' && method === 'POST') {
      const { telegram } = await import('./channels/telegram.js');
      const body = await parseBody(req) as { chatId: string; message: string };
      const result = await telegram.sendToChatId(body.chatId, body.message);
      json(res, result);
      return;
    }

    if (path === '/api/telegram/link' && method === 'GET') {
      const { telegram } = await import('./channels/telegram.js');
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const leadId = url.searchParams.get('leadId') || '';
      const link = telegram.generateStartLink(leadId);
      json(res, { link });
      return;
    }

    // === WHATSAPP INBOX API ===
    if (path === '/api/whatsapp/conversations' && method === 'GET') {
      const { whatsappMessages } = await import('./whatsapp-messages.js');
      const conversations = await whatsappMessages.getConversations();

      // Look up contact names from leads database
      const { leads: leadDB } = await import('./leads.js');
      const allLeads = await leadDB.getAll();
      const leadsByPhone = new Map<string, any>();

      for (const lead of allLeads) {
        if (lead.phone) {
          // Normalize phone: remove all non-digits
          const normalizedPhone = lead.phone.replace(/\D/g, '');
          leadsByPhone.set(normalizedPhone, lead);
        }
      }

      // Enrich conversations with lead info
      const enrichedConversations = conversations.map(conv => {
        // Extract just the digits from the WhatsApp phone
        const waPhone = conv.phone.replace(/\D/g, '');
        const lead = leadsByPhone.get(waPhone);

        if (lead) {
          return {
            ...conv,
            contactName: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || lead.companyName,
            companyName: lead.companyName,
            leadId: lead.id
          };
        }
        return conv;
      });

      json(res, { conversations: enrichedConversations });
      return;
    }

    if (path.match(/^\/api\/whatsapp\/messages\/(.+)$/) && method === 'GET') {
      const jid = decodeURIComponent(path.split('/')[4]);
      const { whatsappMessages } = await import('./whatsapp-messages.js');
      const messages = await whatsappMessages.getMessages(jid, 100);
      // Mark as read when viewing
      await whatsappMessages.markAsRead(jid);
      json(res, { messages });
      return;
    }

    if (path.match(/^\/api\/whatsapp\/reply\/(.+)$/) && method === 'POST') {
      const jid = decodeURIComponent(path.split('/')[4]);
      const body = await parseBody(req) as { message: string };
      const { whatsapp } = await import('./channels/whatsapp.js');
      const result = await whatsapp.sendToJid(jid, body.message);
      json(res, result);
      return;
    }

    if (path === '/api/whatsapp/unread' && method === 'GET') {
      const { whatsappMessages } = await import('./whatsapp-messages.js');
      const count = await whatsappMessages.getUnreadCount();
      json(res, { unreadCount: count });
      return;
    }

    // === MESSAGE TEMPLATES API ===
    if (path === '/api/templates' && method === 'GET') {
      const { messageTemplates } = await import('./message-templates.js');
      const category = url.searchParams.get('category') as any;
      const templates = category
        ? await messageTemplates.getByCategory(category)
        : await messageTemplates.getAll();
      json(res, { templates });
      return;
    }

    if (path === '/api/templates' && method === 'POST') {
      const body = await parseBody(req) as { name: string; category: string; content: string; language: string };
      const { messageTemplates } = await import('./message-templates.js');
      const variables = messageTemplates.extractVariables(body.content);
      const template = await messageTemplates.create({
        name: body.name,
        category: (body.category as any) || 'custom',
        content: body.content,
        variables,
        language: (body.language as any) || 'ru',
      });
      json(res, { template }, 201);
      return;
    }

    const templateMatch = path.match(/^\/api\/templates\/([a-z0-9_]+)$/);
    if (templateMatch) {
      const templateId = templateMatch[1];
      const { messageTemplates } = await import('./message-templates.js');

      if (method === 'GET') {
        const template = await messageTemplates.get(templateId);
        if (!template) {
          json(res, { error: 'Template not found' }, 404);
          return;
        }
        json(res, { template });
        return;
      }

      if (method === 'PUT') {
        const body = await parseBody(req) as Partial<{ name: string; content: string; category: string }>;
        const template = await messageTemplates.update(templateId, body as any);
        if (!template) {
          json(res, { error: 'Template not found' }, 404);
          return;
        }
        json(res, { template });
        return;
      }

      if (method === 'DELETE') {
        const deleted = await messageTemplates.delete(templateId);
        json(res, { deleted });
        return;
      }
    }

    if (path === '/api/templates/render' && method === 'POST') {
      const body = await parseBody(req) as { templateId: string; variables: Record<string, string> };
      const { messageTemplates } = await import('./message-templates.js');
      const template = await messageTemplates.get(body.templateId);
      if (!template) {
        json(res, { error: 'Template not found' }, 404);
        return;
      }
      await messageTemplates.incrementUsage(body.templateId);
      const rendered = messageTemplates.render(template, body.variables || {});
      json(res, { rendered, template });
      return;
    }

    // === MEDIA UPLOAD API ===
    if (path.match(/^\/api\/whatsapp\/media\/(.+)$/) && method === 'POST') {
      const jid = decodeURIComponent(path.split('/')[4]);
      const body = await parseBody(req) as {
        data: string;  // base64 encoded
        mimetype: string;
        filename?: string;
        caption?: string;
      };

      if (!body.data || !body.mimetype) {
        json(res, { error: 'Missing required fields: data, mimetype' }, 400);
        return;
      }

      const { whatsapp } = await import('./channels/whatsapp.js');

      // Decode base64 to buffer
      const mediaBuffer = Buffer.from(body.data, 'base64');

      const result = await whatsapp.sendMediaToJid(jid, mediaBuffer, {
        mimetype: body.mimetype,
        filename: body.filename,
        caption: body.caption
      });

      json(res, result);
      return;
    }

    // === STATIC FILES (from public folder) ===
    if (path === '/' || path === '/index.html') {
      const fs = await import('fs/promises');
      const htmlPath = new URL('../public/index.html', import.meta.url);
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    if (path === '/style.css') {
      const fs = await import('fs/promises');
      const cssPath = new URL('../public/style.css', import.meta.url);
      const css = await fs.readFile(cssPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(css);
      return;
    }

    if (path === '/app.js') {
      const fs = await import('fs/promises');
      const jsPath = new URL('../public/app.js', import.meta.url);
      const js = await fs.readFile(jsPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(js);
      return;
    }

    // === SCRAPERS API ===
    if (path === '/api/scrapers' && method === 'GET') {
      const { listScrapers } = await import('./scraper-registry.js');
      json(res, listScrapers());
      return;
    }

    if (path.startsWith('/api/scrapers/') && path.endsWith('/run') && method === 'POST') {
      const { getScraper, runScraper } = await import('./scraper-registry.js');
      const name = path.split('/')[3];
      const body = await parseBody(req) as Record<string, string>;
      const result = runScraper(name, body);
      json(res, result);
      return;
    }

    if (path.startsWith('/api/scrapers/status/') && method === 'GET') {
      const { getScraperStatus } = await import('./scraper-registry.js');
      const runId = path.split('/')[4];
      const status = getScraperStatus(runId);
      if (status) {
        json(res, status);
      } else {
        json(res, { error: 'Run not found' }, 404);
      }
      return;
    }

    if (path.startsWith('/api/scrapers/stop/') && method === 'POST') {
      const { stopScraper } = await import('./scraper-registry.js');
      const runId = path.split('/')[4];
      const stopped = stopScraper(runId);
      json(res, { stopped });
      return;
    }

    // ===== Chrome Extension Capture =====

    // Capture structured leads from extension
    if (path === '/api/extension/capture' && method === 'POST') {
      const body = await parseBody(req) as {
        url: string;
        title: string;
        leads: Array<{
          companyName: string;
          bin?: string;
          phones: string[];
          emails: string[];
          website?: string;
          address?: string;
          rating?: string;
          category?: string;
          instagramHandle?: string;
          facebookUrl?: string;
          linkedinUrl?: string;
          telegramHandle?: string;
          youtubeUrl?: string;
          tiktokUrl?: string;
          vkUrl?: string;
          socialLinks?: Array<{ platform?: string; text: string; href: string }>;
          rawText?: string;
          sourceUrl?: string;
          needsResearch?: boolean;
          dataCompleteness?: 'full' | 'partial' | 'minimal';
          industry?: string;
        }>;
        metadata: { url: string; title: string; timestamp: string };
      };

      const totalReceived = body.leads?.length || 0;
      console.log(`[Extension] Received ${totalReceived} leads from ${body.url}`);

      let saved = 0;
      let skipped = 0;
      let errors = 0;
      const details: Array<{ company: string; status: string; reason?: string }> = [];

      // Load all existing leads ONCE for fast deduplication
      const existingLeads = await leads.getAll();
      const existingPhones = new Set<string>();
      const existingEmails = new Set<string>();
      const existingCompanies = new Set<string>();

      // Build dedup sets from ALL contacts, not just primary
      for (const l of existingLeads) {
        if (l.phone) existingPhones.add(l.phone.replace(/\D/g, ''));
        if (l.whatsappNumber) existingPhones.add(l.whatsappNumber.replace(/\D/g, ''));
        if (l.email) existingEmails.add(l.email.toLowerCase());
        if (l.companyName) existingCompanies.add(l.companyName.toLowerCase().trim());
        // Also check contacts array for stored phones/emails
        if (Array.isArray((l as any).contacts)) {
          for (const c of (l as any).contacts) {
            if (c.phone) existingPhones.add(c.phone.replace(/\D/g, ''));
            if (c.whatsapp) existingPhones.add(c.whatsapp.replace(/\D/g, ''));
            if (c.email) existingEmails.add(c.email.toLowerCase());
          }
        }
      }

      console.log(`[Extension] Dedup index: ${existingPhones.size} phones, ${existingEmails.size} emails, ${existingCompanies.size} companies`);

      for (const lead of body.leads || []) {
        const companyName = lead.companyName?.trim();

        try {
          // Check ALL phones for dedup (not just first)
          let dupReason = '';
          for (const phone of lead.phones || []) {
            const normalized = phone.replace(/\D/g, '');
            if (normalized && existingPhones.has(normalized)) {
              dupReason = `duplicate_phone:${phone}`;
              break;
            }
          }
          if (!dupReason) {
            for (const email of lead.emails || []) {
              if (email && existingEmails.has(email.toLowerCase())) {
                dupReason = `duplicate_email:${email}`;
                break;
              }
            }
          }
          if (!dupReason && companyName && existingCompanies.has(companyName.toLowerCase())) {
            dupReason = `duplicate_company`;
          }

          if (dupReason) {
            console.log(`[Extension] Skip "${companyName}": ${dupReason}`);
            details.push({ company: companyName || '?', status: 'skipped', reason: dupReason });
            skipped++;
            continue;
          }

          // Add ALL phones/emails to cache so within-batch dupes are caught
          for (const phone of lead.phones || []) {
            const n = phone.replace(/\D/g, '');
            if (n) existingPhones.add(n);
          }
          for (const email of lead.emails || []) {
            if (email) existingEmails.add(email.toLowerCase());
          }
          if (companyName) existingCompanies.add(companyName.toLowerCase());

          // Build contacts array from all phone numbers
          const contacts: Array<{
            name?: string;
            role?: string;
            phone?: string;
            email?: string;
            whatsapp?: string;
            telegram?: string;
            isPrimary?: boolean;
          }> = (lead.phones || []).map((p: string, i: number) => ({
            phone: p,
            whatsapp: p,
            role: i === 0 ? 'Primary' : `Phone ${i + 1}`,
            isPrimary: i === 0
          }));

          // Merge emails into contacts
          (lead.emails || []).forEach((e: string, i: number) => {
            if (i === 0 && contacts.length > 0) {
              contacts[0].email = e;
            } else {
              contacts.push({ email: e, role: `Email ${i + 1}` });
            }
          });

          const phone = lead.phones?.[0] || '';
          const email = lead.emails?.[0] || '';

          // Determine research flag (compute server-side if extension didn't set it)
          const hasContact = phone || email;
          const needsResearch = lead.needsResearch ?? !hasContact;
          const dataCompleteness = lead.dataCompleteness ?? (
            hasContact && lead.bin ? 'full' : hasContact ? 'partial' : 'minimal'
          );
          const baseTags = ['extension-capture'];
          if (needsResearch) baseTags.push('needs-research');

          // Convert to our lead format
          const newLead = {
            companyName: companyName || 'Unknown',
            bin: lead.bin || '',
            phone,
            email,
            website: lead.website || '',
            whatsappNumber: phone,
            contacts,
            instagramHandle: lead.instagramHandle || lead.socialLinks?.find((l: any) => l.href?.includes('instagram'))?.href || '',
            telegramHandle: lead.telegramHandle || lead.socialLinks?.find((l: any) => l.href?.includes('telegram'))?.href || '',
            source: 'extension' as const,
            sourceUrl: lead.sourceUrl || body.url,
            industry: lead.industry || lead.category || '',
            state: 'discovered' as const,
            needsResearch,
            dataCompleteness,
            tags: baseTags,
            notes: [
              lead.address ? `Address: ${lead.address}` : '',
              lead.rating ? `Rating: ${lead.rating}` : '',
              lead.category ? `Category: ${lead.category}` : '',
              lead.facebookUrl ? `Facebook: ${lead.facebookUrl}` : '',
              lead.linkedinUrl ? `LinkedIn: ${lead.linkedinUrl}` : '',
              lead.youtubeUrl ? `YouTube: ${lead.youtubeUrl}` : '',
              lead.tiktokUrl ? `TikTok: ${lead.tiktokUrl}` : '',
              lead.vkUrl ? `VK: ${lead.vkUrl}` : '',
              lead.rawText ? lead.rawText.slice(0, 200) : ''
            ].filter(Boolean)
          };

          await engine.addLead(newLead);
          details.push({ company: companyName || '?', status: 'saved' });
          saved++;
        } catch (err: any) {
          console.error(`[Extension] Failed "${companyName}":`, err.message || err);
          details.push({ company: companyName || '?', status: 'error', reason: err.message });
          errors++;
        }
      }

      console.log(`[Extension] Done: ${saved} saved, ${skipped} skipped, ${errors} errors (of ${totalReceived})`);
      json(res, { success: true, saved, skipped, errors, total: totalReceived, details: details.slice(0, 20) });
      return;
    }

    // Capture full DOM for server-side parsing
    if (path === '/api/extension/capture-dom' && method === 'POST') {
      const body = await parseBody(req) as {
        url: string;
        title: string;
        html: string;
        text: string;
      };

      console.log(`[Extension] Received full DOM from ${body.url} (${body.html?.length || 0} chars)`);

      // Extract leads from text using patterns
      const phonePatterns = [
        /\+?[78][\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}/g,
        /\+?[0-9]{1,3}[\s\-]?\(?[0-9]{3}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{4}/g
      ];
      const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

      const phones: string[] = [];
      const emails: string[] = [];

      for (const pattern of phonePatterns) {
        const matches = body.text?.match(pattern) || [];
        phones.push(...matches);
      }
      emails.push(...(body.text?.match(emailPattern) || []));

      const uniquePhones = [...new Set(phones)];
      const uniqueEmails = [...new Set(emails)];

      // Save as a single "raw capture" for manual processing
      if (uniquePhones.length > 0 || uniqueEmails.length > 0) {
        try {
          await engine.addLead({
            companyName: body.title || 'DOM Capture',
            phone: uniquePhones[0] || '',
            email: uniqueEmails[0] || '',
            source: 'extension' as const,
            sourceUrl: body.url,
            state: 'discovered' as const,
            tags: ['dom-capture', 'needs-parsing'],
            notes: [
              `Phones found: ${uniquePhones.join(', ')}`,
              `Emails found: ${uniqueEmails.join(', ')}`
            ]
          });
        } catch (err) {
          console.error('[Extension] Failed to save DOM capture:', err);
        }
      }

      json(res, {
        success: true,
        leadsFound: Math.max(uniquePhones.length, uniqueEmails.length),
        saved: 1,
        message: `Found ${uniquePhones.length} phones, ${uniqueEmails.length} emails`
      });
      return;
    }

    // 404
    json(res, { error: 'Not found' }, 404);

  } catch (error) {
    console.error('API error:', error);
    json(res, { error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}

/**
 * Start the dashboard server
 */
export async function startDashboard(): Promise<void> {
  await engine.init();

  const server = createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`\n🎯 Sales Dashboard running at http://localhost:${PORT}\n`);
  });
}

/**
 * Dashboard HTML (embedded for simplicity)
 */
function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clawdbot Sales Engine</title>
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a24;
      --bg-hover: #22222e;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #2a2a3a;
      --radius: 12px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
    }

    /* Header */
    .header {
      background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%);
      border-bottom: 1px solid var(--border);
      padding: 1.5rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 1.5rem;
      font-weight: 700;
    }

    .logo-icon {
      font-size: 2rem;
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    /* Buttons */
    .btn {
      padding: 0.625rem 1.25rem;
      border-radius: 8px;
      border: none;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
    }

    .btn-primary {
      background: var(--accent);
      color: white;
    }

    .btn-primary:hover {
      background: #5558e3;
      box-shadow: 0 0 20px var(--accent-glow);
    }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }

    .btn-secondary:hover {
      background: var(--bg-hover);
    }

    .btn-success {
      background: var(--success);
      color: white;
    }

    /* Main Container */
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      transition: all 0.2s;
    }

    .stat-card:hover {
      border-color: var(--accent);
      box-shadow: 0 0 30px var(--accent-glow);
    }

    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .stat-value.success { color: var(--success); }
    .stat-value.warning { color: var(--warning); }
    .stat-value.danger { color: var(--danger); }

    /* Pipeline Funnel */
    .pipeline-section {
      margin-bottom: 2rem;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .pipeline-funnel {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }

    .pipeline-stage {
      flex: 1;
      min-width: 120px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem;
      text-align: center;
      transition: all 0.2s;
      cursor: pointer;
    }

    .pipeline-stage:hover {
      background: var(--bg-hover);
    }

    .pipeline-stage.active {
      border-color: var(--accent);
      background: rgba(99, 102, 241, 0.1);
    }

    .stage-count {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }

    .stage-label {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: capitalize;
    }

    /* Leads Table */
    .leads-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .leads-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .leads-table {
      width: 100%;
      border-collapse: collapse;
    }

    .leads-table th,
    .leads-table td {
      padding: 1rem 1.5rem;
      text-align: left;
    }

    .leads-table th {
      background: var(--bg-secondary);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
    }

    .leads-table tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.2s;
    }

    .leads-table tbody tr:hover {
      background: var(--bg-hover);
    }

    .lead-name {
      font-weight: 600;
    }

    .lead-company {
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .badge-qualified { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .badge-contacted { background: rgba(99, 102, 241, 0.2); color: var(--accent); }
    .badge-replied { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .badge-hot { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .badge-default { background: var(--bg-secondary); color: var(--text-secondary); }

    .score-bar {
      width: 60px;
      height: 6px;
      background: var(--bg-secondary);
      border-radius: 3px;
      overflow: hidden;
    }

    .score-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s;
    }

    .actions-cell {
      display: flex;
      gap: 0.5rem;
    }

    .btn-sm {
      padding: 0.375rem 0.75rem;
      font-size: 0.75rem;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }

    .modal-overlay.active {
      display: flex;
    }

    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-title {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 1.5rem;
      cursor: pointer;
    }

    .modal-body {
      padding: 1.5rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    .form-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
    }

    .form-input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 0.875rem;
    }

    .form-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-secondary);
    }

    /* Loading */
    .loading {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      padding: 1rem 1.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    .toast.success { border-color: var(--success); }
    .toast.error { border-color: var(--danger); }
  </style>
</head>
<body>
  <header class="header">
    <div class="logo">
      <span class="logo-icon">🦞</span>
      <span>Clawdbot Sales Engine</span>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick="runOutreach()">
        ▶️ Run Outreach
      </button>
      <button class="btn btn-primary" onclick="openAddModal()">
        + Add Lead
      </button>
    </div>
  </header>

  <div class="container">
    <!-- Stats -->
    <div class="stats-grid" id="stats-grid">
      <div class="loading"><div class="spinner"></div></div>
    </div>

    <!-- Pipeline Funnel -->
    <div class="pipeline-section">
      <h2 class="section-title">📊 Pipeline</h2>
      <div class="pipeline-funnel" id="pipeline-funnel">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>

    <!-- Leads Table -->
    <div class="leads-section">
      <div class="leads-header">
        <h2 class="section-title" style="margin-bottom: 0">👥 Leads</h2>
        <select id="state-filter" class="form-input" style="width: auto" onchange="loadLeads()">
          <option value="">All States</option>
          <option value="discovered">Discovered</option>
          <option value="qualified">Qualified</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="meeting_booked">Meeting Booked</option>
          <option value="closed_won">Closed Won</option>
          <option value="closed_lost">Closed Lost</option>
        </select>
      </div>
      <table class="leads-table">
        <thead>
          <tr>
            <th>Lead</th>
            <th>State</th>
            <th>Score</th>
            <th>Source</th>
            <th>Last Contact</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="leads-tbody">
          <tr><td colspan="6" class="loading"><div class="spinner"></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Add Lead Modal -->
  <div class="modal-overlay" id="add-modal">
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">Add New Lead</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <form id="add-form" onsubmit="addLead(event)">
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">First Name *</label>
            <input type="text" name="firstName" class="form-input" required>
          </div>
          <div class="form-group">
            <label class="form-label">Last Name</label>
            <input type="text" name="lastName" class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">Company *</label>
            <input type="text" name="companyName" class="form-input" required>
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" name="email" class="form-input">
          </div>
          <div class="form-group">
            <label class="form-label">WhatsApp Number</label>
            <input type="tel" name="whatsappNumber" class="form-input" placeholder="+1234567890">
          </div>
          <div class="form-group">
            <label class="form-label">Industry</label>
            <input type="text" name="industry" class="form-input" placeholder="saas, ecommerce, etc.">
          </div>
          <div class="form-group">
            <label class="form-label">Signal / Context</label>
            <textarea name="signalSummary" class="form-input" rows="2" placeholder="Why are you reaching out?"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Lead</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    const API = '';

    // Toast
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show ' + type;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // Modal
    function openAddModal() {
      document.getElementById('add-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('add-modal').classList.remove('active');
      document.getElementById('add-form').reset();
    }

    // Load Dashboard
    async function loadDashboard() {
      try {
        const res = await fetch(API + '/api/dashboard');
        const data = await res.json();

        // Stats
        const statsHtml = \`
          <div class="stat-card">
            <div class="stat-label">Total Leads</div>
            <div class="stat-value">\${data.stats.total}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Qualified</div>
            <div class="stat-value success">\${data.stats.byState.qualified || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Contacted</div>
            <div class="stat-value">\${data.stats.byState.contacted || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Replied</div>
            <div class="stat-value warning">\${data.stats.byState.replied || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Needs Research</div>
            <div class="stat-value" style="color: var(--accent)">\${data.needsResearch || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Closed Won</div>
            <div class="stat-value success">\${data.stats.byState.closed_won || 0}</div>
          </div>
        \`;
        document.getElementById('stats-grid').innerHTML = statsHtml;

        // Funnel
        const funnelHtml = data.summary.funnel.map(s => \`
          <div class="pipeline-stage" data-state="\${s.state}" onclick="filterByState('\${s.state}')">
            <div class="stage-count">\${s.count}</div>
            <div class="stage-label">\${s.state.replace('_', ' ')}</div>
          </div>
        \`).join('');
        document.getElementById('pipeline-funnel').innerHTML = funnelHtml;

      } catch (err) {
        console.error('Failed to load dashboard:', err);
      }
    }

    // Load Leads
    async function loadLeads() {
      const filter = document.getElementById('state-filter').value;
      const url = filter ? \`\${API}/api/leads?state=\${filter}\` : \`\${API}/api/leads\`;

      try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.leads.length === 0) {
          document.getElementById('leads-tbody').innerHTML = \`
            <tr><td colspan="6" class="empty-state">No leads found. Add one to get started!</td></tr>
          \`;
          return;
        }

        const html = data.leads.map(lead => \`
          <tr>
            <td>
              <div class="lead-name">\${lead.firstName} \${lead.lastName || ''}</div>
              <div class="lead-company">\${lead.companyName}\${lead.bin ? ' <span style="color:var(--text-muted);font-size:11px"> BIN:' + lead.bin + '</span>' : ''}</div>
            </td>
            <td>
              <span class="badge badge-\${getBadgeClass(lead.state)}">\${lead.state}</span>
              \${lead.score >= 80 ? '<span class="badge badge-hot" style="margin-left: 4px">🔥 HOT</span>' : ''}
              \${lead.needsResearch ? '<span class="badge" style="margin-left:4px;background:rgba(99,102,241,0.15);color:#6366f1;border:1px solid rgba(99,102,241,0.3)" title="Needs contact info enrichment">🔍 Research</span>' : ''}
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px">
                <span>\${lead.score}</span>
                <div class="score-bar">
                  <div class="score-fill" style="width: \${Math.min(lead.score, 100)}%"></div>
                </div>
              </div>
            </td>
            <td>\${lead.source}</td>
            <td>\${lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString() : '-'}</td>
            <td class="actions-cell">
              <button class="btn btn-secondary btn-sm" onclick="sendOutreach('\${lead.id}')">📤 Send</button>
              <button class="btn btn-secondary btn-sm" onclick="viewLead('\${lead.id}')">👁️</button>
            </td>
          </tr>
        \`).join('');

        document.getElementById('leads-tbody').innerHTML = html;

      } catch (err) {
        console.error('Failed to load leads:', err);
      }
    }

    function getBadgeClass(state) {
      const map = {
        qualified: 'qualified',
        contacted: 'contacted',
        replied: 'replied',
        meeting_booked: 'warning',
        closed_won: 'success',
      };
      return map[state] || 'default';
    }

    function filterByState(state) {
      document.getElementById('state-filter').value = state;
      loadLeads();
    }

    // Add Lead
    async function addLead(e) {
      e.preventDefault();
      const form = e.target;
      const data = Object.fromEntries(new FormData(form));

      try {
        const res = await fetch(API + '/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!res.ok) throw new Error('Failed to add lead');

        showToast('Lead added successfully!');
        closeModal();
        loadDashboard();
        loadLeads();

      } catch (err) {
        showToast('Failed to add lead', 'error');
      }
    }

    // Send Outreach
    async function sendOutreach(leadId) {
      try {
        const res = await fetch(\`\${API}/api/leads/\${leadId}/outreach\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        const data = await res.json();
        
        if (data.success) {
          showToast(\`Message sent via \${data.channel}!\`);
          loadLeads();
        } else {
          showToast(data.error || 'Failed to send', 'error');
        }

      } catch (err) {
        showToast('Failed to send outreach', 'error');
      }
    }

    // Run Outreach Cycle
    async function runOutreach() {
      try {
        const res = await fetch(API + '/api/outreach/run', { method: 'POST' });
        const data = await res.json();
        showToast(\`Processed \${data.processed} leads, \${data.succeeded} sent\`);
        loadLeads();
      } catch (err) {
        showToast('Failed to run outreach', 'error');
      }
    }

    // View Lead (placeholder)
    function viewLead(leadId) {
      alert('Lead details view coming soon! ID: ' + leadId);
    }

    // Initialize
    loadDashboard();
    loadLeads();

    // Auto-refresh
    setInterval(() => {
      loadDashboard();
      loadLeads();
    }, 30000);
  </script>
</body>
</html>`;
}

// Auto-start if run directly
const currentFile = new URL(import.meta.url).pathname;
if (process.argv[1] === currentFile) {
  startDashboard();
}
