/**
 * Moltbot Skill Handler
 * Command handlers for the sales-engine skill
 */

import { engine, SalesEngine } from './index.js';
import { discovery } from './discovery.js';
import { gateway } from './gateway.js';
import type { Lead, LeadState, Channel } from './types.js';

// Moltbot integration types (external framework)
export interface MoltbotContext {
    text: string;
    lead?: Lead;
    channel: Channel;
    reply: (text: string) => Promise<void>;
    replyWithButtons: (text: string, buttons: string[]) => Promise<void>;
    setState: (key: string, value: unknown) => void;
}

export interface MoltbotGateway {
    onMessage: (handler: (ctx: MoltbotContext) => Promise<void>) => void;
    onButton: (handler: (ctx: MoltbotContext, button: string) => Promise<void>) => void;
}

/**
 * Format lead for display
 */
function formatLead(lead: Lead): string {
    const score = lead.score ? `(${lead.score}pts)` : '';
    const company = lead.companyName || 'Unknown';
    return `• ${lead.firstName} ${lead.lastName || ''} @ ${company} ${score}\n  State: ${lead.state}`;
}

/**
 * Format pipeline stats
 */
function formatPipelineStats(stats: Record<string, number>): string {
    const funnel = [
        { state: 'discovered', emoji: '🔍' },
        { state: 'qualified', emoji: '✅' },
        { state: 'contacted', emoji: '📤' },
        { state: 'replied', emoji: '💬' },
        { state: 'meeting_booked', emoji: '📅' },
        { state: 'closed_won', emoji: '🎉' },
        { state: 'closed_lost', emoji: '❌' },
        { state: 'disqualified', emoji: '🚫' },
    ];

    return funnel
        .filter(f => stats[f.state] > 0)
        .map(f => `${f.emoji} ${f.state}: ${stats[f.state]}`)
        .join('\n');
}

/**
 * /pipeline - View pipeline status
 */
async function handlePipeline(ctx: MoltbotContext): Promise<void> {
    const summary = await engine.getPipelineSummary();
    const stats = await engine.getStats();

    let response = `📊 *Sales Pipeline*\n\n`;
    response += formatPipelineStats(stats.byState);
    response += `\n\n📈 Total: ${stats.total} leads`;

    if (summary.hotLeads.length > 0) {
        response += `\n\n🔥 *Hot Leads (${summary.hotLeads.length})*\n`;
        response += summary.hotLeads.slice(0, 3).map(formatLead).join('\n');
    }

    if (summary.readyForOutreach.length > 0) {
        response += `\n\n📤 *Ready for Outreach: ${summary.readyForOutreach.length}*`;
    }

    await ctx.reply(response);
}

/**
 * /leads [state] - List leads
 */
async function handleLeads(ctx: MoltbotContext): Promise<void> {
    const args = ctx.text.split(' ').slice(1);
    const stateFilter = args[0] as LeadState | undefined;

    let leads: Lead[];
    if (stateFilter) {
        leads = await engine.listLeads({ state: stateFilter });
    } else {
        leads = await engine.listLeads();
    }

    if (leads.length === 0) {
        await ctx.reply(`No leads found${stateFilter ? ` with state: ${stateFilter}` : ''}`);
        return;
    }

    const header = stateFilter ? `Leads (${stateFilter})` : 'All Leads';
    let response = `📋 *${header}* (${leads.length})\n\n`;
    response += leads.slice(0, 10).map(formatLead).join('\n\n');

    if (leads.length > 10) {
        response += `\n\n... and ${leads.length - 10} more`;
    }

    await ctx.reply(response);
}

/**
 * /lead <id> - View lead details
 */
async function handleLead(ctx: MoltbotContext): Promise<void> {
    const args = ctx.text.split(' ').slice(1);
    const leadId = args[0];

    if (!leadId) {
        await ctx.reply('Usage: /lead <id>');
        return;
    }

    const lead = await engine.getLead(leadId);
    if (!lead) {
        await ctx.reply(`Lead not found: ${leadId}`);
        return;
    }

    let response = `👤 *${lead.firstName} ${lead.lastName || ''}*\n`;
    response += `🏢 ${lead.companyName}\n`;
    response += `📊 Score: ${lead.score} | State: ${lead.state}\n`;

    if (lead.email) response += `📧 ${lead.email}\n`;
    if (lead.phone) response += `📱 ${lead.phone}\n`;
    if (lead.linkedinUrl) response += `🔗 LinkedIn: ${lead.linkedinUrl}\n`;

    if (lead.signalSummary) {
        response += `\n💡 Signal: ${lead.signalSummary}`;
    }

    if (lead.currentSequence) {
        response += `\n\n📤 Sequence: ${lead.currentSequence}`;
        if (lead.currentStepId) response += ` (${lead.currentStepId})`;
        if (lead.contactAttempts > 0) response += `\n📤 Contact attempts: ${lead.contactAttempts}`;
    }

    await ctx.replyWithButtons(response, [
        'Send Outreach',
        'Re-qualify',
        'Mark Won',
        'Mark Lost',
    ]);
}

/**
 * /discover - Trigger discovery run
 */
async function handleDiscover(ctx: MoltbotContext): Promise<void> {
    await ctx.reply('🔍 Starting discovery run...');

    const result = await discovery.runDiscovery();

    let response = `✅ *Discovery Complete*\n\n`;
    response += `🔍 Discovered: ${result.discovered}\n`;
    response += `📥 Imported: ${result.imported}\n`;
    response += `✅ Qualified: ${result.qualified}\n`;
    response += `🔄 Duplicates: ${result.duplicates}`;

    if (result.errors.length > 0) {
        response += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join('\n')}`;
    }

    await ctx.reply(response);
}

/**
 * /outreach - Run outreach cycle
 */
async function handleOutreach(ctx: MoltbotContext): Promise<void> {
    await ctx.reply('📤 Running outreach cycle...');

    const result = await engine.runOutreachCycle();

    let response = `✅ *Outreach Complete*\n\n`;
    response += `📤 Processed: ${result.processed}\n`;
    response += `✅ Succeeded: ${result.succeeded}\n`;
    response += `❌ Failed: ${result.failed}`;

    if (result.errors.length > 0) {
        response += `\n\n⚠️ Errors:\n${result.errors.slice(0, 3).join('\n')}`;
    }

    await ctx.reply(response);
}

/**
 * /stats - View conversion metrics
 */
async function handleStats(ctx: MoltbotContext): Promise<void> {
    const stats = await engine.getStats();

    let response = `📊 *Conversion Metrics*\n\n`;
    response += `Total Leads: ${stats.total}\n\n`;

    response += `*By State:*\n`;
    for (const [state, count] of Object.entries(stats.byState)) {
        if (count > 0) response += `• ${state}: ${count}\n`;
    }

    response += `\n*By Source:*\n`;
    for (const [source, count] of Object.entries(stats.bySource)) {
        if (count > 0) response += `• ${source}: ${count}\n`;
    }

    await ctx.reply(response);
}

/**
 * /pause - Pause automation
 */
async function handlePause(ctx: MoltbotContext): Promise<void> {
    ctx.setState('automation_paused', true);
    await ctx.reply('⏸️ Automation paused. Use `/resume` to continue.');
}

/**
 * /resume - Resume automation
 */
async function handleResume(ctx: MoltbotContext): Promise<void> {
    ctx.setState('automation_paused', false);
    await ctx.reply('▶️ Automation resumed.');
}

/**
 * Command router
 */
const commands: Record<string, (ctx: MoltbotContext) => Promise<void>> = {
    '/pipeline': handlePipeline,
    '/leads': handleLeads,
    '/lead': handleLead,
    '/discover': handleDiscover,
    '/outreach': handleOutreach,
    '/stats': handleStats,
    '/pause': handlePause,
    '/resume': handleResume,
};

/**
 * Handle incoming message
 */
export async function handleMessage(ctx: MoltbotContext): Promise<boolean> {
    const text = ctx.text.trim();

    // Check if it's a command
    if (text.startsWith('/')) {
        const cmd = text.split(' ')[0].toLowerCase();
        const handler = commands[cmd];

        if (handler) {
            await handler(ctx);
            return true;
        }
    }

    // Check if this is a reply from a lead we're tracking
    if (ctx.lead) {
        await engine.handleIncomingMessage(
            ctx.lead.id,
            text,
            ctx.channel
        );
        return true;
    }

    return false; // Not handled
}

/**
 * Handle button callback
 */
export async function handleButton(ctx: MoltbotContext, button: string): Promise<void> {
    if (!ctx.lead) {
        await ctx.reply('No lead context for this action');
        return;
    }

    const leadId = ctx.lead.id;

    switch (button) {
        case 'Send Outreach':
            const outreachResult = await engine.startOutreach(leadId);
            await ctx.reply(outreachResult ? '✅ Outreach started' : '❌ Failed to start outreach');
            break;

        case 'Re-qualify':
            const qualResult = await engine.requalifyLead(leadId);
            await ctx.reply(`✅ Re-qualified: Score ${qualResult.result.score}`);
            break;

        case 'Mark Won':
            await engine.moveLeadState(leadId, 'closed_won');
            await ctx.reply('🎉 Marked as Won!');
            break;

        case 'Mark Lost':
            await engine.moveLeadState(leadId, 'closed_lost');
            await ctx.reply('❌ Marked as Lost');
            break;
    }
}

/**
 * Skill initialization - called by Moltbot
 */
export async function initSkill(_moltbotGateway: MoltbotGateway): Promise<void> {
    // Moltbot gateway stored for future integration
    // gateway is the BrowserGateway (Playwright) — no init needed

    // Initialize the engine
    await engine.init();

    console.log('[SKILL] Sales Engine initialized');
}

/**
 * Cron handlers - called by Moltbot scheduler
 */
export const cron = {
    // Run discovery every 6 hours
    async discovery(): Promise<void> {
        console.log('[CRON] Running discovery...');
        await discovery.runDiscovery();
    },

    // Process outreach queue every hour
    async outreach(): Promise<void> {
        console.log('[CRON] Running outreach cycle...');
        await engine.runOutreachCycle();
    },
};

// Export for Moltbot skill registration
export default {
    name: 'sales-engine',
    version: '1.0.0',
    init: initSkill,
    handleMessage,
    handleButton,
    cron,
    commands: Object.keys(commands),
};
