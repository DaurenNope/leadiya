/**
 * WhatsApp Outreach with Mockups
 * Sends personalized offers with mockup images via WhatsApp
 */
import * as fs from 'fs';
import * as path from 'path';
import { leads } from './leads.js';
import { whatsapp } from './channels/whatsapp.js';

interface OfferData {
    company: string;
    phone: string;
    website: string;
    industry: string;
    score: number;
    issues: string[];
    package: string;
    price: string;
    mockup: string;
    message: string;
}

async function loadOffers(): Promise<OfferData[]> {
    const offersPath = './reports/mockups/_offers.json';
    if (!fs.existsSync(offersPath)) {
        console.log('No offers found. Run irresistible-offer-generator.ts first.');
        return [];
    }
    return JSON.parse(fs.readFileSync(offersPath, 'utf-8'));
}

async function sendOutreach(dryRun: boolean = true): Promise<void> {
    await leads.connect();

    const offers = await loadOffers();
    console.log(`\n=== WHATSAPP OUTREACH ===\n`);
    console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE SEND'}`);
    console.log(`Offers to send: ${offers.length}\n`);

    for (const offer of offers) {
        console.log(`--- ${offer.company} ---`);
        console.log(`Phone: ${offer.phone}`);
        console.log(`Package: ${offer.package} (${offer.price})`);
        console.log(`Mockup: ${offer.mockup}`);
        console.log(`\nMessage:\n${offer.message}`);

        if (!dryRun) {
            // Find lead
            const allLeads = await leads.getByState('discovered');
            const lead = allLeads.find(l => l.phone === offer.phone);

            if (lead) {
                // Send message
                const result = await whatsapp.send(lead, offer.message);

                if (result.success) {
                    console.log(`\n✓ Message sent!`);

                    // TODO: Send image separately
                    // WhatsApp API requires separate call for images
                    // await whatsapp.sendImage(lead, offer.mockup);

                    await leads.update(lead.id, {
                        state: 'contacted',
                        lastContactedAt: new Date()
                    });
                } else {
                    console.log(`\n✗ Failed: ${result.error}`);
                }

                // Rate limit
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        console.log('\n' + '='.repeat(50) + '\n');
    }

    console.log('=== SUMMARY ===');
    console.log(`Total offers: ${offers.length}`);
    console.log(`\nTo send for real, run with: sendOutreach(false)`);

    await leads.disconnect();
}

// Export for testing
export { loadOffers, sendOutreach };

// Run in dry-run mode by default
sendOutreach(true).catch(console.error);
