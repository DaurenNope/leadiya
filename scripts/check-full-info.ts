import { createClient } from 'redis';

async function checkFullInfo() {
    const client = createClient({ url: 'redis://localhost:6379' });
    await client.connect();

    const ids = await client.sMembers('sales:leads:all');

    let total = 0;
    let phoneOnly = 0;
    let emailOnly = 0;
    let both = 0;
    let neither = 0;
    const fullInfoLeads: any[] = [];

    for (const id of ids) {
        const data = await client.get(`sales:leads:${id}`);
        if (data) {
            const lead = JSON.parse(data);
            total++;

            const hasPhone = !!lead.phone;
            const hasEmail = !!lead.email;

            if (hasPhone && hasEmail) {
                both++;
                fullInfoLeads.push(lead);
            } else if (hasPhone) {
                phoneOnly++;
            } else if (hasEmail) {
                emailOnly++;
            } else {
                neither++;
            }
        }
    }

    console.log('=== LEAD CONTACT BREAKDOWN ===');
    console.log('Total leads:        ', total);
    console.log('Email + Phone:      ', both, '<-- FULL INFO');
    console.log('Phone only:         ', phoneOnly);
    console.log('Email only:         ', emailOnly);
    console.log('Neither:            ', neither);

    if (fullInfoLeads.length > 0) {
        console.log('');
        console.log('=== FULL INFO LEADS (with both email + phone) ===');
        fullInfoLeads.forEach(lead => {
            const name = (lead.companyName || '').substring(0, 28).padEnd(28);
            const email = (lead.email || '').substring(0, 25).padEnd(25);
            console.log(name, email, lead.phone);
        });
    }

    await client.quit();
}

checkFullInfo();
