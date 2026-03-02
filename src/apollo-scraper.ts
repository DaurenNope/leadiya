/**
 * Apollo.io API Lead Scraper
 * Pulls US/EU leads with verified emails and phones
 */
import { leads } from './leads.js';
import 'dotenv/config';

const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const APOLLO_API_URL = 'https://api.apollo.io/v1/mixed_people/search';

interface ApolloLead {
    id: string;
    first_name: string;
    last_name: string;
    name: string;
    title: string;
    email: string;
    phone_numbers?: Array<{ raw_number: string }>;
    organization?: {
        name: string;
        website_url: string;
        industry: string;
        estimated_num_employees: number;
    };
    city: string;
    state: string;
    country: string;
}

interface SearchConfig {
    locations: string[];
    industries: string[];
    titles: string[];
    employeeRanges: string[];
    limit: number;
}

// US/EU target configuration
const SEARCH_CONFIG: SearchConfig = {
    locations: ['United States', 'United Kingdom', 'Germany', 'France', 'Netherlands'],
    industries: [
        'Education',
        'Higher Education',
        'E-Learning',
        'Logistics and Supply Chain',
        'Transportation/Trucking/Railroad',
        'Real Estate',
        'Commercial Real Estate'
    ],
    titles: [
        'CEO',
        'Founder',
        'Co-Founder',
        'Director',
        'VP',
        'Head of',
        'Managing Director',
        'Owner'
    ],
    employeeRanges: ['11,50', '51,200', '201,500'],
    limit: 100 // Max per request
};

async function searchApollo(config: SearchConfig, page: number = 1): Promise<ApolloLead[]> {
    const body = {
        page: page,
        per_page: config.limit,
        person_locations: config.locations,
        organization_industry_tag_ids: config.industries,
        person_titles: config.titles,
        organization_num_employees_ranges: config.employeeRanges,
        // Only get contacts with emails
        contact_email_status: ['verified', 'likely']
    };

    console.log(`📡 Fetching page ${page}...`);

    const response = await fetch(APOLLO_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'X-Api-Key': APOLLO_API_KEY!
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Apollo API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    console.log(`   Found ${data.people?.length || 0} contacts (total: ${data.pagination?.total_entries || 0})`);

    return data.people || [];
}

async function main() {
    console.log('🚀 Apollo.io Lead Scraper\n');

    if (!APOLLO_API_KEY) {
        console.error('❌ APOLLO_API_KEY not found in .env');
        process.exit(1);
    }

    console.log('🎯 Target Markets: US, UK, Germany, France, Netherlands');
    console.log('🏢 Industries: Education, Logistics, Real Estate');
    console.log('👔 Titles: CEO, Founder, Director, VP, Head of\n');

    await leads.connect();

    try {
        // Fetch first batch
        const apolloLeads = await searchApollo(SEARCH_CONFIG, 1);

        let saved = 0;
        let withPhone = 0;
        let withEmail = 0;

        for (const lead of apolloLeads) {
            const phone = lead.phone_numbers?.[0]?.raw_number;
            const email = lead.email;

            if (email) withEmail++;
            if (phone) withPhone++;

            // Save to our database
            await leads.create({
                firstName: lead.first_name || '',
                lastName: lead.last_name || '',
                companyName: lead.organization?.name || '',
                phone: phone,
                whatsappNumber: phone,
                email: email,
                website: lead.organization?.website_url,
                source: 'apollo',
                state: 'discovered',
                signalSummary: `${lead.organization?.industry || 'unknown'}: ${lead.country}`,
                tags: [
                    lead.organization?.industry || 'unknown',
                    lead.country || 'unknown',
                    lead.title || 'unknown'
                ],
                notes: [
                    `Title: ${lead.title}`,
                    `Company size: ${lead.organization?.estimated_num_employees || 'unknown'}`,
                    `Location: ${lead.city}, ${lead.state}, ${lead.country}`
                ]
            });
            saved++;

            console.log(`✓ ${lead.name?.substring(0, 25).padEnd(25)} | ${lead.title?.substring(0, 20).padEnd(20)} | ${lead.organization?.name?.substring(0, 25)}`);
        }

        console.log('\n📊 RESULTS');
        console.log(`   Fetched: ${apolloLeads.length}`);
        console.log(`   With email: ${withEmail}`);
        console.log(`   With phone: ${withPhone}`);
        console.log(`   Saved: ${saved}`);

        const stats = await leads.getStats();
        console.log(`\n📈 Total leads in DB: ${stats.total}`);

    } catch (error) {
        console.error('❌ Error:', error);
    }

    await leads.disconnect();
}

main();
