// Cleanup script - delete leads without contacts
const API = 'http://localhost:3000/api';

async function main() {
    const res = await fetch(`${API}/leads`);
    const data = await res.json();
    const leads = data.leads || [];

    console.log('Total leads:', leads.length);

    const toDelete = [];
    const toKeep = [];

    for (const lead of leads) {
        const hasPhone = lead.phone && lead.phone.trim().length > 0;
        const hasEmail = lead.email && lead.email.trim().length > 0;

        if (hasPhone || hasEmail) {
            toKeep.push(lead);
        } else {
            toDelete.push(lead);
        }
    }

    console.log('With contacts:', toKeep.length);
    console.log('Without contacts:', toDelete.length);

    let deleted = 0;
    for (const lead of toDelete) {
        try {
            await fetch(`${API}/leads/${lead.id}`, { method: 'DELETE' });
            deleted++;
            if (deleted % 20 === 0) {
                console.log(`Progress: ${deleted}/${toDelete.length}`);
            }
        } catch (e) {
            console.error('Failed to delete:', lead.id);
        }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Deleted ${deleted} leads without contacts`);
    console.log(`Remaining: ${toKeep.length} quality leads`);
}

main().catch(console.error);
