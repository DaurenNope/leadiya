import { createClient } from 'redis';

const leads = [
    // Real Estate Agencies (13)
    { id: "lead_038", companyName: "Галерея Новостроек", address: "ЖК Арай, улица Айманова, 140 блок Б1, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_039", companyName: "Отбасы Home", address: "Улица Солодовникова, 21е, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_040", companyName: "Grand Estate Company", address: "БЦ Шартас, улица Амангельды, 59а, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_041", companyName: "Vernao group", address: "Проспект Жибек Жолы, 104, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_042", companyName: "ЖИЛСЕРВИС", address: "БЦ RD, Абая проспект, 115а, Алматы", phone: "+77088648393", category: "Недвижимость" },
    { id: "lead_043", companyName: "Мечта", address: "ЖК LAMIYA, улица Ади Шарипова, 145 к2, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_044", companyName: "Центр Риелторских Услуг", address: "ЖК Lake Town, улица Варламова, 27а, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_045", companyName: "Мой Дом KZ", address: "Абая проспект, 68, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_046", companyName: "dom.kz", address: "БЦ Алатау Гранд, улица Тимирязева, 28в, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_047", companyName: "Legenda", address: "Улица Шевченко, 186, Алматы", phone: "+77082955475", category: "Недвижимость" },
    { id: "lead_048", companyName: "4You", address: "Нурлы-Тау, проспект Аль-Фараби, 17 к4Б, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_049", companyName: "Atrium Home", address: "БЦ Алатау, Абая проспект, 151, Алматы", phone: "", category: "Недвижимость" },
    { id: "lead_050", companyName: "Квартира в аренду рядом", address: "ЖК Арай, улица Айманова, 140 блок Б1, Алматы", phone: "+77088648393", category: "Недвижимость" },
];

async function saveLeads() {
    const client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await client.connect();

    let saved = 0;
    for (const lead of leads) {
        const now = new Date().toISOString();
        const leadData = {
            id: lead.id,
            firstName: "Директор",
            companyName: lead.companyName,
            phone: lead.phone,
            source: "scrape",
            state: "discovered",
            signalSummary: lead.category,
            address: lead.address,
            tags: JSON.stringify([lead.category.toLowerCase().replace(' ', '_'), "almaty", lead.phone ? "has_phone" : "no_phone"]),
            createdAt: now,
            contactAttempts: "0",
            conversationHistory: "[]"
        };

        await client.hSet(`sales:leads:${lead.id}`, leadData);
        saved++;
        console.log(`Saved ${lead.companyName}`);
    }

    console.log(`\n✅ Total saved: ${saved} leads`);

    // Get count
    const keys = await client.keys('sales:leads:*');
    console.log(`📊 Total leads in DB: ${keys.length}`);

    await client.quit();
}

saveLeads().catch(console.error);
