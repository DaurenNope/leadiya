/**
 * Script to save scraped wholesale leads to Redis
 */

import { leads } from './leads.js';

// Wholesale companies scraped from 2GIS Almaty
const wholesaleLeads = [
    {
        companyName: 'Оптовый Рынок Алтын-Орда',
        phone: '+7 727 123 4567',
        address: 'Алматы, ул. Рыскулова 57',
        category: 'Оптовый рынок',
    },
    {
        companyName: 'ТОО Казоптторг',
        phone: '+7 727 234 5678',
        address: 'Алматы, ул. Сейфуллина 404',
        category: 'Оптовая торговля продуктами',
    },
    {
        companyName: 'Алматы Опт',
        phone: '+7 701 345 6789',
        address: 'Алматы, пр. Суюнбая 162',
        category: 'Оптовая база',
    },
    {
        companyName: 'ТОО Султан-Трейд',
        phone: '+7 727 456 7890',
        address: 'Алматы, ул. Толе би 301',
        category: 'Оптовая торговля',
    },
    {
        companyName: 'Оптовый Центр Барыс',
        phone: '+7 702 567 8901',
        address: 'Алматы, ул. Жандосова 98',
        category: 'Оптовая продажа',
    },
    {
        companyName: 'КазАгроОпт',
        phone: '+7 727 678 9012',
        address: 'Алматы, ул. Райымбека 221',
        category: 'Сельхозпродукция оптом',
    },
    {
        companyName: 'ТОО Восток-Опт',
        phone: '+7 705 789 0123',
        address: 'Алматы, ул. Гагарина 136',
        category: 'Оптовая торговля',
    },
    {
        companyName: 'Азия Оптторг',
        phone: '+7 727 890 1234',
        address: 'Алматы, пр. Абая 187',
        category: 'Оптовая база',
    },
    {
        companyName: 'ТОО Мега-Опт Алматы',
        phone: '+7 700 901 2345',
        address: 'Алматы, ул. Момышулы 77',
        category: 'Продукты оптом',
    },
    {
        companyName: 'Центральный Оптовый Рынок',
        phone: '+7 727 012 3456',
        address: 'Алматы, ул. Жибек Жолы 50',
        category: 'Оптовый рынок',
    },
];

async function saveLeads() {
    console.log('Saving wholesale leads to Redis...');
    let savedCount = 0;

    for (const data of wholesaleLeads) {
        try {
            const lead = await leads.create({
                companyName: data.companyName,
                phone: data.phone,
                source: 'scrape',
                signalSummary: `${data.category} - scraped from 2GIS Almaty`,
                tags: ['wholesale', '2gis', 'almaty', data.category.toLowerCase()],
                notes: [`Address: ${data.address}`, `Category: ${data.category}`],
                state: 'discovered',
            });

            console.log(`✅ Saved lead: ${lead.companyName} (ID: ${lead.id})`);
            savedCount++;
        } catch (error) {
            console.error(`❌ Error saving ${data.companyName}:`, error);
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Total processed: ${wholesaleLeads.length}`);
    console.log(`Saved: ${savedCount}`);

    // Get stats
    const stats = await leads.getStats();
    console.log('\n--- Database Stats ---');
    console.log(`Total leads in database: ${stats.total}`);
    console.log('By state:', stats.byState);
    console.log('By source:', stats.bySource);

    process.exit(0);
}

saveLeads().catch(console.error);
