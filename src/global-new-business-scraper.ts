/**
 * OpenCorporates - Global New Business Registrations Scraper
 * Covers 140+ countries with 200M+ companies
 * Free API: 500 requests/day (no key needed for basic searches)
 */
import { leads } from './leads.js';
import 'dotenv/config';

const OPENCORPORATES_API = 'https://api.opencorporates.com/v0.4';
const API_TOKEN = process.env.OPENCORPORATES_API_TOKEN; // Optional, increases rate limit

interface OpenCorpCompany {
    name: string;
    company_number: string;
    jurisdiction_code: string;
    incorporation_date: string;
    company_type: string;
    current_status: string;
    registered_address_in_full: string;
    opencorporates_url: string;
    officers?: Array<{
        name: string;
        position: string;
        start_date: string;
    }>;
}

// Target jurisdictions with good data quality
const TARGET_JURISDICTIONS = [
    // USA (by state)
    'us_de', 'us_ca', 'us_ny', 'us_tx', 'us_fl', 'us_wa', 'us_co', 'us_ma',
    // UK
    'gb',
    // Europe
    'de', 'fr', 'nl', 'ie', 'be',
    // Other
    'ca', 'au', 'nz', 'sg', 'hk'
];

// Get companies registered in the last N days
function getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

async function searchNewCompanies(jurisdiction: string, daysAgo: number = 30): Promise<OpenCorpCompany[]> {
    const incorporatedAfter = getDateDaysAgo(daysAgo);

    let url = `${OPENCORPORATES_API}/companies/search?` + new URLSearchParams({
        jurisdiction_code: jurisdiction,
        incorporated_from: incorporatedAfter,
        current_status: 'Active',
        per_page: '30',
        order: 'incorporation_date'
    });

    if (API_TOKEN) {
        url += `&api_token=${API_TOKEN}`;
    }

    console.log(`📡 Searching ${jurisdiction.toUpperCase()} (since ${incorporatedAfter})...`);

    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        if (response.status === 429) {
            console.log(`   ⏳ Rate limited, waiting...`);
            await new Promise(r => setTimeout(r, 5000));
            return [];
        }
        console.log(`   ⚠️ Error: ${response.status}`);
        return [];
    }

    const data = await response.json();
    const companies = data.results?.companies || [];

    console.log(`   Found ${companies.length} new companies`);

    return companies.map((c: any) => c.company);
}

async function getCompanyOfficers(companyUrl: string): Promise<any[]> {
    // OpenCorporates requires a token to fetch officers on free tier
    // For now, we'll skip this - the basic info is still valuable
    return [];
}

function formatJurisdiction(code: string): string {
    const map: Record<string, string> = {
        'us_de': 'USA (Delaware)',
        'us_ca': 'USA (California)',
        'us_ny': 'USA (New York)',
        'us_tx': 'USA (Texas)',
        'us_fl': 'USA (Florida)',
        'us_wa': 'USA (Washington)',
        'us_co': 'USA (Colorado)',
        'us_ma': 'USA (Massachusetts)',
        'gb': 'United Kingdom',
        'de': 'Germany',
        'fr': 'France',
        'nl': 'Netherlands',
        'ie': 'Ireland',
        'be': 'Belgium',
        'ca': 'Canada',
        'au': 'Australia',
        'nz': 'New Zealand',
        'sg': 'Singapore',
        'hk': 'Hong Kong'
    };
    return map[code] || code.toUpperCase();
}

async function main() {
    console.log('🌍 OpenCorporates - Global New Business Scraper\n');
    console.log('📊 Coverage: 140+ countries, 200M+ companies\n');

    const daysAgo = 30; // Look back 30 days
    console.log(`🎯 Finding companies registered in the last ${daysAgo} days\n`);

    await leads.connect();

    let totalFound = 0;
    let totalSaved = 0;
    const byJurisdiction: Record<string, number> = {};

    for (const jurisdiction of TARGET_JURISDICTIONS) {
        try {
            const companies = await searchNewCompanies(jurisdiction, daysAgo);

            byJurisdiction[jurisdiction] = companies.length;
            totalFound += companies.length;

            for (const company of companies) {
                // Parse company name for potential contact info
                // New businesses often register with owner's name
                const nameParts = company.name.split(' ');

                await leads.create({
                    firstName: '',
                    lastName: '',
                    companyName: company.name,
                    source: 'opencorporates' as any,
                    state: 'discovered',
                    signalSummary: `new_business: ${formatJurisdiction(jurisdiction)}`,
                    tags: [
                        'new_business',
                        jurisdiction,
                        company.company_type || 'unknown'
                    ],
                    notes: [
                        `Registered: ${company.incorporation_date}`,
                        `Company #: ${company.company_number}`,
                        `Type: ${company.company_type}`,
                        `Address: ${company.registered_address_in_full || 'N/A'}`,
                        `Link: ${company.opencorporates_url}`
                    ]
                });
                totalSaved++;

                console.log(`   ✓ ${company.name.substring(0, 50)}`);
            }

            // Rate limiting - be nice to the API
            await new Promise(r => setTimeout(r, 1000));

        } catch (error) {
            console.log(`   ❌ Error for ${jurisdiction}:`, error);
        }
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 RESULTS');
    console.log('='.repeat(50));
    console.log(`\nTotal new companies found: ${totalFound}`);
    console.log(`Total leads saved: ${totalSaved}`);

    console.log('\nBy Region:');
    Object.entries(byJurisdiction)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .forEach(([jur, count]) => {
            console.log(`  ${formatJurisdiction(jur).padEnd(20)} ${count}`);
        });

    const stats = await leads.getStats();
    console.log(`\n📈 Total leads in DB: ${stats.total}`);

    await leads.disconnect();
}

main();
