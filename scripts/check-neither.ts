import { createClient } from 'redis';

async function check() {
    const client = createClient({ url: 'redis://localhost:6379' });
    await client.connect();

    const ids = await client.sMembers('sales:leads:all');
    let count = 0;
    const byVertical: Record<string, number> = {};
    const byCity: Record<string, number> = {};

    console.log('=== SAMPLE LEADS WITH NO CONTACT INFO ===\n');

    for (const id of ids) {
        const data = await client.get(`sales:leads:${id}`);
        if (data) {
            const lead = JSON.parse(data);
            if (!lead.phone && !lead.email) {
                count++;

                const summary = lead.signalSummary || '';
                const parts = summary.split(': ');
                const vertical = parts[0] || 'unknown';
                const city = parts[1] || 'unknown';

                byVertical[vertical] = (byVertical[vertical] || 0) + 1;
                byCity[city] = (byCity[city] || 0) + 1;

                if (count <= 20) {
                    console.log(lead.companyName?.substring(0, 40).padEnd(40), '|', summary);
                }
            }
        }
    }

    console.log('\n=== WHY NO CONTACTS? ===');
    console.log('Total "neither":', count);

    console.log('\nBy Vertical:');
    Object.entries(byVertical).sort((a, b) => b[1] - a[1]).forEach(([v, n]) => {
        console.log('  ', v.padEnd(12), n);
    });

    console.log('\nBy City:');
    Object.entries(byCity).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => {
        console.log('  ', c.padEnd(12), n);
    });

    await client.quit();
}

check();
