/**
 * Cleanup Script - Remove garbage leads
 */
import { leads } from './leads.js';

async function cleanUp() {
    await leads.connect();
    const all = await leads.getAll();

    const garbagePatterns = [
        /2ГИС/,
        /на карте/,
        /телефоны/,
        /отзывы/,
        /Реклама/,
        /☎/,
        /★/,
        /Акция действует/,
        /в одном месте/,
        /Покупайте онлайн/,
        /Позвонить$/,
        /Перейти на сайт/,
        /условиями рассрочки/,
        /^[А-Я][а-я]+ в [А-Я][а-я]+[ае] на карте/,
        /^Университет[а-я]?$/i,  // "Университетф", "Университеты"
        /и институты$/,
        /^Застройщики$/,
        /^Новостройки$/,
        /^ИП предприятия/,
        /^[А-Яа-я]+ логистика$/,  // "Астана логистика"
        /^[А-Яа-я]+ университеты$/,  // "Астана университеты"
        /Строительство бань/,
        /надёжного застройщика/,
        /Розница$/,
        /^Строй будущее/,
        /^ЗастройщикиНовостройки$/,
        /качественное образование/i,
        /престижный диплом/i,
        /инновационным обучением/i,
        /высоким уровнем/i,
        /надёжные решения/i,
    ];

    let deleted = 0;
    const kept: string[] = [];

    for (const lead of all) {
        const name = lead.companyName || '';

        // Check garbage patterns
        const isGarbage = garbagePatterns.some(p => p.test(name)) ||
            name.length > 70 ||
            name.length < 5;

        if (isGarbage) {
            await leads.delete(lead.id);
            console.log('❌ Deleted:', name.substring(0, 50));
            deleted++;
        } else {
            kept.push(name);
        }
    }

    console.log('\n=== CLEAN LEADS ===\n');

    // Group by vertical
    const remainingLeads = await leads.getAll();
    const education = remainingLeads.filter(l => l.tags?.includes('education'));
    const logistics = remainingLeads.filter(l => l.tags?.includes('logistics'));
    const realestate = remainingLeads.filter(l => l.tags?.includes('realestate'));

    console.log('📚 EDUCATION:', education.length);
    education.slice(0, 10).forEach(l => console.log('   •', l.companyName));
    if (education.length > 10) console.log('   ... and', education.length - 10, 'more');

    console.log('\n🚛 LOGISTICS:', logistics.length);
    logistics.slice(0, 10).forEach(l => console.log('   •', l.companyName));
    if (logistics.length > 10) console.log('   ... and', logistics.length - 10, 'more');

    console.log('\n🏢 REAL ESTATE:', realestate.length);
    realestate.slice(0, 10).forEach(l => console.log('   •', l.companyName));
    if (realestate.length > 10) console.log('   ... and', realestate.length - 10, 'more');

    const stats = await leads.getStats();
    console.log('\n📊 SUMMARY:');
    console.log('   Deleted:', deleted);
    console.log('   Remaining:', stats.total);

    await leads.disconnect();
}

cleanUp();
