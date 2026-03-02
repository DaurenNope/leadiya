import { leads } from './leads.js';

async function verify() {
    const allLeads = await leads.getAll();
    console.log(`Total leads: ${allLeads.length}`);
    console.log('\nSample leads:');
    allLeads.slice(0, 3).forEach((lead, i) => {
        console.log(`\n--- Lead ${i + 1} ---`);
        console.log(`Company: ${lead.companyName}`);
        console.log(`Phone: ${lead.phone}`);
        console.log(`State: ${lead.state}`);
        console.log(`Tags: ${lead.tags?.join(', ')}`);
    });
    process.exit(0);
}

verify();
