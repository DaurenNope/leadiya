/**
 * Pipeline State Machine
 * Manages lead state transitions and triggers actions
 */

import type { Lead, LeadState, PipelineEvent, Channel } from './types.js';
import { leads, LeadRepository } from './leads.js';
import { config, ConfigLoader } from './config.js';

// Valid state transitions
const TRANSITIONS: Record<LeadState, LeadState[]> = {
    discovered: ['enriched', 'disqualified'],
    enriched: ['qualified', 'disqualified'],
    qualified: ['contacted', 'disqualified', 'paused'],
    contacted: ['replied', 'contacted', 'disqualified', 'paused'], // can re-contact (followup)
    replied: ['meeting_booked', 'contacted', 'closed_lost', 'paused'],
    meeting_booked: ['proposal_sent', 'negotiating', 'closed_lost', 'paused'],
    proposal_sent: ['negotiating', 'closed_won', 'closed_lost', 'paused'],
    negotiating: ['closed_won', 'closed_lost', 'paused'],
    closed_won: [], // terminal
    closed_lost: ['contacted'], // can re-engage
    disqualified: ['qualified'], // can re-qualify
    paused: ['contacted', 'qualified'], // can resume
};

export class Pipeline {
    private leadRepo: LeadRepository;
    private configLoader: ConfigLoader;
    private eventHandlers: Map<PipelineEvent['type'], ((event: PipelineEvent) => Promise<void>)[]> = new Map();

    constructor(leadRepo?: LeadRepository, configLoader?: ConfigLoader) {
        this.leadRepo = leadRepo || leads;
        this.configLoader = configLoader || config;
    }

    /**
     * Register an event handler
     */
    on(eventType: PipelineEvent['type'], handler: (event: PipelineEvent) => Promise<void>): void {
        const handlers = this.eventHandlers.get(eventType) || [];
        handlers.push(handler);
        this.eventHandlers.set(eventType, handlers);
    }

    /**
     * Emit an event to all handlers
     */
    private async emit(event: PipelineEvent): Promise<void> {
        const handlers = this.eventHandlers.get(event.type) || [];
        for (const handler of handlers) {
            try {
                await handler(event);
            } catch (error) {
                console.error(`Error in pipeline handler for ${event.type}:`, error);
            }
        }
    }

    /**
     * Check if transition is valid
     */
    canTransition(from: LeadState, to: LeadState): boolean {
        return TRANSITIONS[from]?.includes(to) ?? false;
    }

    /**
     * Transition lead to new state
     */
    async transition(leadId: string, newState: LeadState, reason?: string): Promise<Lead | null> {
        const lead = await this.leadRepo.get(leadId);
        if (!lead) {
            console.error(`Lead not found: ${leadId}`);
            return null;
        }

        if (!this.canTransition(lead.state, newState)) {
            console.error(`Invalid transition: ${lead.state} -> ${newState}`);
            return null;
        }

        const updated = await this.leadRepo.update(leadId, {
            state: newState,
            notes: reason ? [...lead.notes, `[${new Date().toISOString()}] ${reason}`] : lead.notes,
        });

        console.log(`Lead ${leadId}: ${lead.state} -> ${newState}`);
        return updated;
    }

    /**
     * Process a pipeline event
     */
    async process(event: PipelineEvent): Promise<void> {
        console.log(`Pipeline event: ${event.type}`);

        switch (event.type) {
            case 'LEAD_DISCOVERED': {
                await this.leadRepo.create(event.payload);
                break;
            }

            case 'LEAD_ENRICHED': {
                const { leadId, data } = event.payload;
                await this.leadRepo.update(leadId, data);
                await this.transition(leadId, 'enriched', 'Enrichment complete');
                break;
            }

            case 'LEAD_QUALIFIED': {
                const { leadId, score } = event.payload;
                await this.leadRepo.update(leadId, { score });
                await this.transition(leadId, 'qualified', `Score: ${score}`);
                break;
            }

            case 'LEAD_DISQUALIFIED': {
                const { leadId, reason } = event.payload;
                await this.transition(leadId, 'disqualified', reason);
                break;
            }

            case 'MESSAGE_SENT': {
                const { leadId, message } = event.payload;
                await this.leadRepo.addMessage(leadId, message);

                const lead = await this.leadRepo.get(leadId);
                if (lead?.state === 'qualified') {
                    await this.transition(leadId, 'contacted', 'Initial outreach sent');
                }
                break;
            }

            case 'MESSAGE_RECEIVED': {
                const { leadId, message } = event.payload;
                await this.leadRepo.addMessage(leadId, message);

                const lead = await this.leadRepo.get(leadId);
                if (lead?.state === 'contacted') {
                    await this.transition(leadId, 'replied', 'Received response');
                }
                break;
            }

            case 'MEETING_BOOKED': {
                const { leadId, meetingTime } = event.payload;
                await this.leadRepo.update(leadId, {
                    notes: [`Meeting scheduled: ${meetingTime.toISOString()}`],
                });
                await this.transition(leadId, 'meeting_booked', 'Meeting scheduled');
                break;
            }

            case 'PROPOSAL_SENT': {
                const { leadId, proposalLink } = event.payload;
                await this.leadRepo.update(leadId, {
                    notes: [`Proposal sent: ${proposalLink}`],
                });
                await this.transition(leadId, 'proposal_sent', 'Proposal delivered');
                break;
            }

            case 'DEAL_WON': {
                const { leadId, value } = event.payload;
                await this.transition(leadId, 'closed_won', value ? `Deal value: $${value}` : 'Deal closed');
                break;
            }

            case 'DEAL_LOST': {
                const { leadId, reason } = event.payload;
                await this.transition(leadId, 'closed_lost', reason || 'Deal lost');
                break;
            }
        }

        // Emit to external handlers
        await this.emit(event);
    }

    /**
     * Get pipeline summary
     */
    async getSummary(): Promise<{
        funnel: { state: LeadState; count: number }[];
        hotLeads: Lead[];
        readyForOutreach: Lead[];
    }> {
        const stats = await this.leadRepo.getStats();
        const allLeads = await this.leadRepo.getAll();
        const icpConfig = this.configLoader.loadICP();

        const funnel: { state: LeadState; count: number }[] = [
            { state: 'discovered', count: stats.byState['discovered'] || 0 },
            { state: 'enriched', count: stats.byState['enriched'] || 0 },
            { state: 'qualified', count: stats.byState['qualified'] || 0 },
            { state: 'contacted', count: stats.byState['contacted'] || 0 },
            { state: 'replied', count: stats.byState['replied'] || 0 },
            { state: 'meeting_booked', count: stats.byState['meeting_booked'] || 0 },
            { state: 'proposal_sent', count: stats.byState['proposal_sent'] || 0 },
            { state: 'closed_won', count: stats.byState['closed_won'] || 0 },
        ];

        const hotLeads = allLeads
            .filter(l => l.score >= icpConfig.thresholds.hot)
            .sort((a, b) => b.score - a.score)
            .slice(0, 10);

        const readyForOutreach = await this.leadRepo.getReadyForOutreach();

        return { funnel, hotLeads, readyForOutreach };
    }
}

// Singleton instance
export const pipeline = new Pipeline();
