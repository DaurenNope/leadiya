/**
 * Outreach Engine
 * Handles message composition, scheduling, and delivery
 */

import Handlebars from 'handlebars';
import { addDays, addHours, addMinutes, parseISO } from 'date-fns';
import type { Lead, Channel, SequenceStep, Message } from './types.js';
import { config, ConfigLoader } from './config.js';
import { leads, LeadRepository } from './leads.js';
import { pipeline, Pipeline } from './pipeline.js';
import { messenger, type Messenger } from './channels/index.js';

export class OutreachEngine {
    private configLoader: ConfigLoader;
    private leadRepo: LeadRepository;
    private pipelineRef: Pipeline;

    constructor(configLoader?: ConfigLoader, leadRepo?: LeadRepository, pipelineRef?: Pipeline) {
        this.configLoader = configLoader || config;
        this.leadRepo = leadRepo || leads;
        this.pipelineRef = pipelineRef || pipeline;
    }

    /**
     * Parse delay string to milliseconds
     * Supports: 0, 1h, 2d, 30m
     */
    private parseDelay(delay: string): number {
        if (delay === '0') return 0;

        const match = delay.match(/^(\d+)(m|h|d)$/);
        if (!match) return 0;

        const [, amount, unit] = match;
        const num = parseInt(amount, 10);

        switch (unit) {
            case 'm': return num * 60 * 1000;
            case 'h': return num * 60 * 60 * 1000;
            case 'd': return num * 24 * 60 * 60 * 1000;
            default: return 0;
        }
    }

    /**
     * Calculate next contact time based on delay
     */
    private calculateNextContact(delay: string): Date {
        const ms = this.parseDelay(delay);
        return new Date(Date.now() + ms);
    }

    /**
     * Resolve channel from config
     */
    private resolveChannel(channelRef: string): Channel {
        const business = this.configLoader.loadBusiness();

        switch (channelRef) {
            case 'primary': return business.channels.primary;
            case 'fallback': return business.channels.fallback;
            case 'tertiary': return business.channels.tertiary || business.channels.fallback;
            default: return channelRef as Channel;
        }
    }

    /**
     * Get contact handle for a channel
     */
    private getContactHandle(lead: Lead, channel: Channel): string | null {
        switch (channel) {
            case 'whatsapp': return lead.whatsappNumber || lead.phone || null;
            case 'telegram': return lead.telegramHandle || null;
            case 'email': return lead.email || null;
            default: return null;
        }
    }

    /**
     * Compose message from template
     */
    composeMessage(template: string, lead: Lead, extraContext?: Record<string, string>): string {
        const business = this.configLoader.loadBusiness();

        const context = {
            // Lead fields
            first_name: lead.firstName,
            last_name: lead.lastName || '',
            company: lead.companyName,
            industry: lead.industry || 'your industry',

            // Signals
            signal_summary: lead.signalSummary || 'growing',
            pain_point: lead.painPoint || 'scaling',
            recent_activity: lead.recentActivity || '',

            // Business fields
            value_prop: business.product.valueProps[0],
            calendar_url: business.company.calendarUrl,
            signature: business.voice.signature,
            company_name: business.company.name,

            // Extra context (for meeting notes, proposals, etc.)
            ...extraContext,
        };

        const compiled = Handlebars.compile(template);
        return compiled(context).trim();
    }

    /**
     * Get next sequence step for a lead
     */
    getNextStep(lead: Lead): SequenceStep | null {
        if (!lead.currentSequence) return null;

        const sequences = this.configLoader.loadSequences();
        const sequence = sequences.sequences[lead.currentSequence];
        if (!sequence) return null;

        const currentIndex = sequence.steps.findIndex(s => s.id === lead.currentStepId);

        // If no current step, start from beginning
        if (currentIndex === -1) {
            return sequence.steps[0] || null;
        }

        // Get next step
        const nextStep = sequence.steps[currentIndex + 1];
        if (!nextStep) return null;

        // Check conditions
        if (nextStep.condition === 'no_response') {
            // Only proceed if no response received
            if (lead.lastMessageReceived && new Date(lead.lastMessageReceived) > (lead.lastContactedAt || new Date(0))) {
                return null; // They responded, stop sequence
            }
        }

        return nextStep;
    }

    /**
     * Start a sequence for a lead
     */
    async startSequence(leadId: string, sequenceName: string): Promise<boolean> {
        const lead = await this.leadRepo.get(leadId);
        if (!lead) return false;

        const sequences = this.configLoader.loadSequences();
        const sequence = sequences.sequences[sequenceName];
        if (!sequence) {
            console.error(`Sequence not found: ${sequenceName}`);
            return false;
        }

        await this.leadRepo.update(leadId, {
            currentSequence: sequenceName,
            currentStepId: undefined, // Will start from first step
        });

        console.log(`Started sequence '${sequenceName}' for lead ${leadId}`);
        return true;
    }

    /**
     * Execute next outreach step for a lead
     */
    async executeStep(leadId: string): Promise<{
        success: boolean;
        channel?: Channel;
        message?: string;
        error?: string;
    }> {
        const lead = await this.leadRepo.get(leadId);
        if (!lead) {
            return { success: false, error: 'Lead not found' };
        }

        const business = this.configLoader.loadBusiness();

        // Check daily limits
        const todayContacts = await this.getTodayContactCount();
        if (todayContacts >= business.automation.maxOutreachPerDay) {
            return { success: false, error: 'Daily outreach limit reached' };
        }

        // Check lead-specific limits
        if (lead.contactAttempts >= business.automation.maxFollowupsPerLead) {
            return { success: false, error: 'Max followups reached for this lead' };
        }

        // Get next step
        const step = this.getNextStep(lead);
        if (!step) {
            // No current sequence - start cold outreach for qualified leads
            if (lead.state === 'qualified' && !lead.currentSequence) {
                await this.startSequence(leadId, 'cold_outreach');
                return this.executeStep(leadId); // Retry with sequence started
            }
            return { success: false, error: 'No next step in sequence' };
        }

        // Resolve channel
        const channel = this.resolveChannel(step.channel);

        // Compose message
        const message = this.composeMessage(step.template, lead);

        // === SEND VIA MESSENGER ===
        const sendResult = await messenger.send(lead, message, channel);

        if (!sendResult.success) {
            return {
                success: false,
                error: sendResult.error || 'Failed to send message',
                channel: sendResult.channel,
            };
        }

        // Create message record
        const messageData: Omit<Message, 'id'> = {
            direction: 'outbound',
            channel: sendResult.channel,
            content: message,
            timestamp: new Date(),
            sequenceId: lead.currentSequence,
            stepId: step.id,
        };

        // Calculate next contact time
        const nextStep = this.getNextStepAfter(lead.currentSequence!, step.id);
        const nextContactAt = nextStep ? this.calculateNextContact(nextStep.delay) : undefined;

        // Update lead
        await this.leadRepo.update(leadId, {
            currentStepId: step.id,
            nextContactAt,
        });

        // Process through pipeline
        await this.pipelineRef.process({
            type: 'MESSAGE_SENT',
            payload: { leadId, message: { ...messageData, id: sendResult.messageId || '' } as Message },
        });

        return {
            success: true,
            channel: sendResult.channel,
            message,
        };
    }

    /**
     * Get the step after a given step in a sequence
     */
    private getNextStepAfter(sequenceName: string, currentStepId: string): SequenceStep | null {
        const sequences = this.configLoader.loadSequences();
        const sequence = sequences.sequences[sequenceName];
        if (!sequence) return null;

        const currentIndex = sequence.steps.findIndex(s => s.id === currentStepId);
        return sequence.steps[currentIndex + 1] || null;
    }

    /**
     * Get count of contacts made today
     */
    async getTodayContactCount(): Promise<number> {
        const allLeads = await this.leadRepo.getAll();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return allLeads.reduce((count, lead) => {
            if (lead.lastContactedAt && new Date(lead.lastContactedAt) >= today) {
                return count + 1;
            }
            return count;
        }, 0);
    }

    /**
     * Process all leads ready for outreach
     */
    async processReadyLeads(): Promise<{
        processed: number;
        succeeded: number;
        failed: number;
        errors: string[];
    }> {
        const readyLeads = await this.leadRepo.getReadyForOutreach();
        const results = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            errors: [] as string[],
        };

        for (const lead of readyLeads) {
            results.processed++;

            const result = await this.executeStep(lead.id);

            if (result.success) {
                results.succeeded++;
                console.log(`✓ Sent to ${lead.firstName} (${lead.companyName}) via ${result.channel}`);
            } else {
                results.failed++;
                results.errors.push(`${lead.id}: ${result.error}`);
            }
        }

        return results;
    }

    /**
     * Handle incoming response with intelligent classification
     */
    async handleResponse(leadId: string, content: string, channel: Channel): Promise<{
        intent: string;
        action: string;
        autoReplySent: boolean;
    }> {
        const { responseClassifier } = await import('./response-classifier.js');
        const business = this.configLoader.loadBusiness();
        const sequences = this.configLoader.loadSequences();

        // Classify the response
        const classification = responseClassifier.classify(content);
        console.log(`[RESPONSE] Lead ${leadId}: "${content.slice(0, 50)}..." → ${classification.intent} (${(classification.confidence * 100).toFixed(0)}%)`);

        // Record the message
        const message: Omit<Message, 'id'> = {
            direction: 'inbound',
            channel,
            content,
            timestamp: new Date(),
        };

        await this.pipelineRef.process({
            type: 'MESSAGE_RECEIVED',
            payload: { leadId, message: { ...message, id: '' } as Message },
        });

        // Route based on classification
        let autoReplySent = false;
        const lead = await this.leadRepo.get(leadId);

        switch (classification.suggestedAction) {
            case 'schedule_meeting':
                // Move to meeting_booked state
                await this.pipelineRef.transition(leadId, 'meeting_booked', `Response: ${classification.intent}`);
                // Stop outreach sequence
                await this.leadRepo.update(leadId, {
                    currentSequence: undefined,
                    currentStepId: undefined,
                    nextContactAt: undefined,
                });
                break;

            case 'archive':
                // Move to closed_lost
                await this.pipelineRef.transition(leadId, 'closed_lost', `Response: ${classification.intent}`);
                await this.leadRepo.update(leadId, {
                    currentSequence: undefined,
                    currentStepId: undefined,
                    nextContactAt: undefined,
                });
                break;

            case 'escalate':
                // Keep in current state but flag for human review
                await this.leadRepo.update(leadId, {
                    tags: [...(lead?.tags || []), 'needs_attention'],
                });
                break;

            case 'wait':
                // Out of office or neutral - keep monitoring
                break;

            case 'send_followup':
                // Question received - could auto-reply
                break;
        }

        // Check for auto-reply triggers
        const lowerContent = content.toLowerCase();

        for (const [key, autoReply] of Object.entries(sequences.responses.autoReplies)) {
            const triggered = autoReply.trigger.some(t => lowerContent.includes(t.toLowerCase()));

            if (triggered && lead) {
                const response = this.composeMessage(autoReply.response, lead);
                console.log(`[AUTO-REPLY] Triggered (${key}): ${response.slice(0, 50)}...`);
                // Send response via the same channel
                await (await import('./channels/index.js')).messenger.sendVia(channel, lead, response);
                autoReplySent = true;
                break;
            }
        }

        return {
            intent: classification.intent,
            action: classification.suggestedAction,
            autoReplySent
        };
    }
}

// Singleton instance
export const outreach = new OutreachEngine();
