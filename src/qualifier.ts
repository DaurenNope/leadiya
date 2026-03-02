/**
 * Lead Qualification Engine
 * Scores leads based on ICP criteria and signals
 */

import type { Lead, ICPConfig, SignalPattern } from './types.js';
import { config, ConfigLoader } from './config.js';

export interface QualificationResult {
    score: number;
    qualified: boolean;
    hot: boolean;
    breakdown: {
        industry: number;
        companySize: number;
        role: number;
        geography: number;
        signals: number;
    };
    matchedSignals: string[];
    disqualifyReasons: string[];
}

export class Qualifier {
    private configLoader: ConfigLoader;

    constructor(configLoader?: ConfigLoader) {
        this.configLoader = configLoader || config;
    }

    /**
     * Score a lead against ICP
     */
    qualify(lead: Partial<Lead>): QualificationResult {
        const icp = this.configLoader.loadICP();
        const breakdown = {
            industry: 0,
            companySize: 0,
            role: 0,
            geography: 0,
            signals: 0,
        };
        const matchedSignals: string[] = [];
        const disqualifyReasons: string[] = [];

        // === Industry scoring ===
        if (lead.industry) {
            const industry = lead.industry.toLowerCase();

            // Check exclusions first (instant disqualify)
            if (icp.targeting.industries.exclude.some(ex => industry.includes(ex.toLowerCase()))) {
                disqualifyReasons.push(`Excluded industry: ${lead.industry}`);
                breakdown.industry = -100;
            } else if (icp.targeting.industries.include.some(inc => industry.includes(inc.toLowerCase()))) {
                breakdown.industry = icp.targeting.industries.weight;
            }
        }

        // === Company size scoring ===
        if (lead.companySize !== undefined) {
            const size = lead.companySize;
            const target = icp.targeting.companySize;

            if (size < target.min || size > target.max) {
                breakdown.companySize = 0;
            } else if (size >= target.idealMin && size <= target.idealMax) {
                breakdown.companySize = target.weight; // Ideal range = full points
            } else {
                breakdown.companySize = Math.round(target.weight * 0.6); // In range but not ideal
            }
        }

        // === Role scoring ===
        // Check LinkedIn URL or any role indicators in recent activity
        const roleText = [
            lead.recentActivity,
            lead.signalSummary,
            lead.linkedinUrl,
        ].filter(Boolean).join(' ').toLowerCase();

        if (icp.targeting.roles.exclude.some(role => roleText.includes(role.toLowerCase()))) {
            disqualifyReasons.push('Excluded role detected');
            breakdown.role = -50;
        } else if (icp.targeting.roles.include.some(role => roleText.includes(role.toLowerCase()))) {
            breakdown.role = icp.targeting.roles.weight;
        }

        // === Signal scoring ===
        const textToScan = [
            lead.recentActivity,
            lead.signalSummary,
            lead.painPoint,
        ].filter(Boolean).join(' ').toLowerCase();

        // Strong positive signals
        for (const signal of icp.signals.strongPositive) {
            if (textToScan.includes(signal.pattern.toLowerCase())) {
                breakdown.signals += signal.score;
                matchedSignals.push(signal.pattern);
            }
        }

        // Moderate positive signals
        for (const signal of icp.signals.moderatePositive) {
            if (textToScan.includes(signal.pattern.toLowerCase())) {
                breakdown.signals += signal.score;
                matchedSignals.push(signal.pattern);
            }
        }

        // Negative signals (can disqualify)
        for (const signal of icp.signals.negative) {
            if (textToScan.includes(signal.pattern.toLowerCase())) {
                breakdown.signals += signal.score;
                if (signal.score <= -100) {
                    disqualifyReasons.push(`Negative signal: ${signal.pattern}`);
                }
            }
        }

        // === Calculate total score ===
        const score = Math.max(0,
            breakdown.industry +
            breakdown.companySize +
            breakdown.role +
            breakdown.geography +
            breakdown.signals
        );

        // === Determine qualification ===
        const qualified = score >= icp.thresholds.qualified && disqualifyReasons.length === 0;
        const hot = score >= icp.thresholds.hot;

        return {
            score,
            qualified,
            hot,
            breakdown,
            matchedSignals,
            disqualifyReasons,
        };
    }

    /**
     * Extract signals from raw text (for discovery)
     */
    extractSignals(text: string): { pattern: string; score: number }[] {
        const icp = this.configLoader.loadICP();
        const allSignals = [
            ...icp.signals.strongPositive,
            ...icp.signals.moderatePositive,
            ...icp.signals.negative,
        ];

        const found: { pattern: string; score: number }[] = [];
        const lowerText = text.toLowerCase();

        for (const signal of allSignals) {
            if (lowerText.includes(signal.pattern.toLowerCase())) {
                found.push(signal);
            }
        }

        return found;
    }

    /**
     * Generate signal summary for personalization
     */
    generateSignalSummary(matchedSignals: string[]): string {
        if (matchedSignals.length === 0) return '';

        // Pick the most interesting signal for the opening
        const prioritySignals = [
            'building mvp',
            'want to automate',
            'looking for developer',
            'need to build',
            'raised funding',
            'hiring engineers',
        ];

        const bestMatch = prioritySignals.find(p =>
            matchedSignals.some(s => s.toLowerCase().includes(p))
        );

        if (bestMatch) {
            const signalMap: Record<string, string> = {
                'building mvp': 'building something new',
                'want to automate': 'looking to automate',
                'looking for developer': 'looking for dev talent',
                'need to build': 'looking to build something',
                'raised funding': 'recently raised funding',
                'hiring engineers': 'growing the engineering team',
            };
            return signalMap[bestMatch] || matchedSignals[0];
        }

        return matchedSignals[0];
    }
}

// Singleton instance
export const qualifier = new Qualifier();
