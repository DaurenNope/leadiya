/**
 * Automation Controller
 * Orchestrates the complete lead pipeline: Scrape → Qualify → Outreach
 */

import { twoGISScraper } from './2gis-scraper.js';
import { leads } from './leads.js';
import { qualifier } from './qualifier.js';
import { outreach } from './outreach.js';
import { pipeline } from './pipeline.js';
import { config } from './config.js';
import type { Lead } from './types.js';
import type { DiscoveredLead } from './discovery.js';

export interface CycleResult {
    status: 'success' | 'partial' | 'error';
    timestamp: Date;
    duration: number; // ms
    stats: {
        leadsDiscovered: number;
        leadsQualified: number;
        leadsContacted: number;
        errors: string[];
    };
}

export interface AutomationStatus {
    running: boolean;
    lastCycle: CycleResult | null;
    config: {
        mode: string;
        maxOutreachPerDay: number;
        intervalMinutes: number;
    };
    stats: {
        todayContacted: number;
        cycleCount: number;
    };
}

export class AutomationController {
    private running = false;
    private intervalHandle: NodeJS.Timeout | null = null;
    private intervalMinutes = 60; // Default: hourly
    private lastCycle: CycleResult | null = null;
    private cycleCount = 0;

    /**
     * Run a complete automation cycle
     */
    async runCycle(): Promise<CycleResult> {
        const startTime = Date.now();
        const errors: string[] = [];
        let leadsDiscovered = 0;
        let leadsQualified = 0;
        let leadsContacted = 0;

        console.log('[AUTOMATION] Starting cycle...');

        try {
            // STEP 1: Discover new leads from 2GIS
            console.log('[AUTOMATION] Step 1: Discovering leads from 2GIS...');
            const discovered = await this.discoverLeads();
            leadsDiscovered = discovered.length;
            console.log(`[AUTOMATION] Discovered ${leadsDiscovered} new leads`);

            // STEP 2: Qualify leads
            console.log('[AUTOMATION] Step 2: Qualifying leads...');
            leadsQualified = await this.qualifyNewLeads();
            console.log(`[AUTOMATION] Qualified ${leadsQualified} leads`);

            // STEP 3: Execute outreach for qualified leads
            console.log('[AUTOMATION] Step 3: Executing outreach...');
            const outreachResult = await this.executeOutreach();
            leadsContacted = outreachResult.succeeded;
            if (outreachResult.errors.length > 0) {
                errors.push(...outreachResult.errors);
            }
            console.log(`[AUTOMATION] Contacted ${leadsContacted} leads`);

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`Cycle error: ${errorMsg}`);
            console.error('[AUTOMATION] Cycle error:', error);
        }

        const result: CycleResult = {
            status: errors.length === 0 ? 'success' : (leadsContacted > 0 ? 'partial' : 'error'),
            timestamp: new Date(),
            duration: Date.now() - startTime,
            stats: {
                leadsDiscovered,
                leadsQualified,
                leadsContacted,
                errors,
            },
        };

        this.lastCycle = result;
        this.cycleCount++;

        console.log(`[AUTOMATION] Cycle complete in ${result.duration}ms`);
        return result;
    }

    /**
     * Step 1: Discover new leads from 2GIS
     */
    private async discoverLeads(): Promise<DiscoveredLead[]> {
        await leads.connect();

        // Check if scraper is ready
        if (!(await twoGISScraper.isReady())) {
            console.log('[AUTOMATION] 2GIS scraper not ready (no browser)');
            return [];
        }

        const discovered = await twoGISScraper.discover();

        // Save discovered leads to database
        for (const lead of discovered) {
            try {
                // Check if lead already exists (by company name)
                const existing = await leads.findByCompany(lead.companyName);
                if (existing) {
                    // UPDATE existing lead with new data (e.g., website contacts)
                    const updates: Record<string, unknown> = {};

                    // Only update if we have new data
                    if (lead.rawData) {
                        // Merge rawData - new data takes precedence (always overwrite)
                        const existingRaw = (existing as any).rawData || {};
                        updates.rawData = { ...existingRaw, ...lead.rawData };

                        // Always update main fields with new scraped data (decoded URLs)
                        // This ensures old masked URLs get replaced with decoded ones
                        if (lead.rawData.email) {
                            updates.email = lead.rawData.email;
                        }
                        if (lead.rawData.website) {
                            updates.website = lead.rawData.website;
                        }
                        if (lead.rawData.whatsapp) {
                            updates.whatsappNumber = lead.rawData.whatsapp;
                        }
                    }

                    // Update other fields if provided and not already set
                    if (lead.phone && !existing.phone) updates.phone = lead.phone;

                    if (Object.keys(updates).length > 0) {
                        await leads.update(existing.id, updates);
                        console.log(`[AUTOMATION] Updated existing lead: ${lead.companyName}`);
                    } else {
                        console.log(`[AUTOMATION] Lead already exists, no new data: ${lead.companyName}`);
                    }
                    continue;
                }

                // Create new lead in discovered state
                await leads.create({
                    companyName: lead.companyName,
                    firstName: lead.firstName,
                    lastName: lead.lastName || '',
                    phone: lead.phone,
                    email: lead.rawData?.email || '',  // Add email to main field for UI
                    website: lead.rawData?.website || '',
                    whatsappNumber: lead.rawData?.whatsapp || '',
                    source: 'scrape',
                    state: 'discovered',
                    tags: lead.signals || [],
                    rawData: lead.rawData,
                } as any);
            } catch (err) {
                console.error(`[AUTOMATION] Error saving lead ${lead.companyName}:`, err);
            }
        }

        return discovered;
    }

    /**
     * Step 2: Qualify new leads
     */
    private async qualifyNewLeads(): Promise<number> {
        await leads.connect();
        const businessConfig = config.loadBusiness();

        // Get all discovered (unqualified) leads
        const discoveredLeads = await leads.getByState('discovered');
        let qualifiedCount = 0;

        for (const lead of discoveredLeads) {
            const result = qualifier.qualify(lead);

            if (result.disqualifyReasons.length > 0) {
                // Disqualify
                await leads.update(lead.id, {
                    state: 'disqualified',
                    score: result.score,
                    notes: [...lead.notes, `Disqualified: ${result.disqualifyReasons.join(', ')}`],
                });
            } else if (result.qualified) {
                // Qualify and assign to sequence
                await leads.update(lead.id, {
                    state: 'qualified',
                    score: result.score,
                    signalSummary: qualifier.generateSignalSummary(result.matchedSignals),
                });

                // Auto-start sequence if in fully_automatic mode
                if (businessConfig.automation.mode === 'fully_automatic') {
                    await outreach.startSequence(lead.id, 'initial');
                }

                qualifiedCount++;
            } else {
                // Not qualified but not disqualified - move to enriched for review
                await leads.update(lead.id, {
                    state: 'enriched',
                    score: result.score,
                });
            }
        }

        return qualifiedCount;
    }

    /**
     * Step 3: Execute outreach for ready leads
     */
    private async executeOutreach(): Promise<{ succeeded: number; failed: number; errors: string[] }> {
        const businessConfig = config.loadBusiness();

        // Check daily limit
        const todayCount = await outreach.getTodayContactCount();
        const maxDaily = businessConfig.automation.maxOutreachPerDay;

        if (todayCount >= maxDaily) {
            console.log(`[AUTOMATION] Daily limit reached (${todayCount}/${maxDaily})`);
            return { succeeded: 0, failed: 0, errors: ['Daily limit reached'] };
        }

        const remaining = maxDaily - todayCount;
        console.log(`[AUTOMATION] Outreach remaining today: ${remaining}`);

        // Process ready leads (up to remaining limit)
        const result = await outreach.processReadyLeads();

        return {
            succeeded: result.succeeded,
            failed: result.failed,
            errors: result.errors,
        };
    }

    /**
     * Start automated cycling at interval
     */
    start(intervalMinutes?: number): void {
        if (this.running) {
            console.log('[AUTOMATION] Already running');
            return;
        }

        this.intervalMinutes = intervalMinutes || this.intervalMinutes;
        this.running = true;

        console.log(`[AUTOMATION] Starting automation (every ${this.intervalMinutes} minutes)`);

        // Run immediately, then at interval
        this.runCycle();

        this.intervalHandle = setInterval(
            () => this.runCycle(),
            this.intervalMinutes * 60 * 1000
        );
    }

    /**
     * Stop automated cycling
     */
    stop(): void {
        if (!this.running) {
            console.log('[AUTOMATION] Not running');
            return;
        }

        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }

        this.running = false;
        console.log('[AUTOMATION] Automation stopped');
    }

    /**
     * Get current status
     */
    async getStatus(): Promise<AutomationStatus> {
        const businessConfig = config.loadBusiness();
        const todayContacted = await outreach.getTodayContactCount();

        return {
            running: this.running,
            lastCycle: this.lastCycle,
            config: {
                mode: businessConfig.automation.mode,
                maxOutreachPerDay: businessConfig.automation.maxOutreachPerDay,
                intervalMinutes: this.intervalMinutes,
            },
            stats: {
                todayContacted,
                cycleCount: this.cycleCount,
            },
        };
    }

    /**
     * Set automation interval
     */
    setInterval(minutes: number): void {
        this.intervalMinutes = minutes;

        // Restart if running
        if (this.running) {
            this.stop();
            this.start(minutes);
        }
    }

    /**
     * Check if automation is running
     */
    isRunning(): boolean {
        return this.running;
    }
}

// Singleton
export const automation = new AutomationController();
