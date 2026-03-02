/**
 * Core type definitions for the Sales Engine
 */

// =============================================================================
// LEAD TYPES
// =============================================================================

export type LeadState =
    | 'discovered'      // Found via scraping/webhook
    | 'enriched'        // Data gathered
    | 'qualified'       // Passed ICP scoring
    | 'contacted'       // First outreach sent
    | 'replied'         // They responded
    | 'meeting_booked'  // Call scheduled
    | 'proposal_sent'   // Proposal delivered
    | 'negotiating'     // In discussions
    | 'closed_won'      // Deal done
    | 'closed_lost'     // No deal
    | 'disqualified'    // Failed ICP
    | 'paused';         // Manually paused

export type LeadSource =
    | 'linkedin'
    | 'twitter'
    | 'telegram'       // Telegram groups/channels
    | 'scrape'         // Web scrapers (HH, VC.ru, etc.)
    | 'webhook'
    | 'rss'
    | 'referral'
    | 'manual'
    | 'inbound'
    | 'import'
    | 'apollo'         // Apollo.io API
    | 'extension';     // Chrome extension captures

export type Channel = 'whatsapp' | 'email' | 'telegram';

/**
 * Contact person within a lead
 */
export interface Contact {
    name?: string;           // e.g., "Asel Nurbekova"
    role?: string;           // e.g., "Sales Manager", "Director", "PM"
    phone?: string;          // Phone number
    email?: string;          // Email address
    whatsapp?: string;       // WhatsApp (if different from phone)
    telegram?: string;       // Telegram handle
    isPrimary?: boolean;     // Primary contact for outreach
    notes?: string;          // Additional notes
    status?: 'active' | 'no_reply' | 'wrong_number' | 'blocked';  // Contact status for rotation
    lastAttemptAt?: Date;    // When we last tried this contact
    attemptCount?: number;   // How many times we tried
}

export interface Lead {
    id: string;

    // Core identity
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;              // Primary phone (backward compatible)

    // Company info
    companyName: string;
    bin?: string;                    // БИН/ИИН (KZ company registration number)
    companySize?: number;
    industry?: string;
    website?: string;

    // Social handles (for company)
    linkedinUrl?: string;
    twitterHandle?: string;
    telegramHandle?: string;
    whatsappNumber?: string;     // Primary WhatsApp (backward compatible)

    // Multiple contacts
    contacts?: Contact[];        // All contacts at this company

    // Pipeline state
    state: LeadState;
    score: number;
    source: LeadSource;
    sourceUrl?: string;         // URL where lead was found

    // Context
    signalSummary?: string;        // Why we reached out
    recentActivity?: string;       // What they're doing
    painPoint?: string;            // Their problem

    // Sequence tracking
    currentSequence?: string;      // e.g., 'cold_outreach'
    currentStepId?: string;        // e.g., 'followup_1'
    lastContactedAt?: Date;
    nextContactAt?: Date;
    contactAttempts: number;

    // Conversation
    lastMessageSent?: string;
    lastMessageReceived?: string;
    conversationHistory: Message[];

    // Metadata
    createdAt: Date;
    updatedAt: Date;
    tags: string[];
    notes: string[];

    // Research & enrichment tracking
    needsResearch?: boolean;         // No direct contact info — needs enrichment
    dataCompleteness?: 'full' | 'partial' | 'minimal';  // full=phone+BIN, partial=phone only, minimal=BIN only
}

export interface Message {
    id: string;
    direction: 'inbound' | 'outbound';
    channel: Channel;
    content: string;
    timestamp: Date;
    sequenceId?: string;
    stepId?: string;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface BusinessConfig {
    company: {
        name: string;
        tagline: string;
        website: string;
        calendarUrl: string;
    };
    product: {
        name: string;
        description: string;
        valueProps: string[];
        painPoints: string[];
    };
    channels: {
        primary: Channel;
        fallback: Channel;
        tertiary?: Channel;
    };
    voice: {
        tone: string;
        language: string;
        signature: string;
        traits: string[];
    };
    automation: {
        mode: 'fully_automatic' | 'approval_required' | 'hybrid';
        maxOutreachPerDay: number;
        maxFollowupsPerLead: number;
        cooldownAfterResponse: boolean;
    };
    discovery: {
        schedule: string;
        sources: LeadSource[];
    };
}

export interface ICPConfig {
    targeting: {
        industries: {
            include: string[];
            exclude: string[];
            weight: number;
        };
        companySize: {
            min: number;
            max: number;
            idealMin: number;
            idealMax: number;
            weight: number;
        };
        roles: {
            include: string[];
            exclude: string[];
            weight: number;
        };
        geography: {
            include: string[];
            exclude: string[];
            weight: number;
        };
    };
    signals: {
        strongPositive: SignalPattern[];
        moderatePositive: SignalPattern[];
        negative: SignalPattern[];
    };
    thresholds: {
        qualified: number;
        hot: number;
        disqualified: number;
    };
    enrichment: {
        required: string[];
        optional: string[];
    };
}

export interface SignalPattern {
    pattern: string;
    score: number;
}

export interface SequenceStep {
    id: string;
    delay: string;           // e.g., '0', '3d', '1h'
    channel: 'primary' | 'email' | 'fallback' | Channel;
    template: string;
    condition?: 'no_response' | 'send_proposal' | string;
}

export interface Sequence {
    trigger: string;
    cooldown?: string;
    steps: SequenceStep[];
}

export interface SequencesConfig {
    sequences: Record<string, Sequence>;
    responses: {
        positiveSignals: string[];
        autoReplies: Record<string, {
            trigger: string[];
            response: string;
        }>;
    };
}

// =============================================================================
// PIPELINE EVENTS
// =============================================================================

export type PipelineEvent =
    | { type: 'LEAD_DISCOVERED'; payload: Partial<Lead> }
    | { type: 'LEAD_ENRICHED'; payload: { leadId: string; data: Partial<Lead> } }
    | { type: 'LEAD_QUALIFIED'; payload: { leadId: string; score: number } }
    | { type: 'LEAD_DISQUALIFIED'; payload: { leadId: string; reason: string } }
    | { type: 'MESSAGE_SENT'; payload: { leadId: string; message: Message } }
    | { type: 'MESSAGE_RECEIVED'; payload: { leadId: string; message: Message } }
    | { type: 'MEETING_BOOKED'; payload: { leadId: string; meetingTime: Date } }
    | { type: 'PROPOSAL_SENT'; payload: { leadId: string; proposalLink: string } }
    | { type: 'DEAL_WON'; payload: { leadId: string; value?: number } }
    | { type: 'DEAL_LOST'; payload: { leadId: string; reason?: string } };

// =============================================================================
// STATS & METRICS
// =============================================================================

export interface PipelineStats {
    total: number;
    byState: Record<LeadState, number>;
    bySource: Record<LeadSource, number>;
    today: {
        discovered: number;
        contacted: number;
        replied: number;
        booked: number;
    };
    conversionRates: {
        discoveredToQualified: number;
        qualifiedToContacted: number;
        contactedToReplied: number;
        repliedToBooked: number;
        bookedToWon: number;
    };
}
