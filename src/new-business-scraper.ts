/**
 * UK Companies House - New Business Registrations Scraper
 * Targets newly registered companies (highest intent leads!)
 * Free API: 600 requests per 5 minutes
 */
import { leads } from './leads.js';
import 'dotenv/config';

const COMPANIES_HOUSE_API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const BASE_URL = 'https://api.company-information.service.gov.uk';

interface CompanySearchResult {
    company_name: string;
    company_number: string;
    company_status: string;
    date_of_creation: string;
    registered_office_address?: {
        address_line_1?: string;
        locality?: string;
        postal_code?: string;
        country?: string;
    };
    sic_codes?: string[];
}

interface Officer {
    name: string;
    officer_role: string;
    appointed_on: string;
}

// SIC codes for target industries
const TARGET_SIC_CODES: Record<string, string[]> = {
    restaurants: ['56101', '56102', '56103', '56210', '56290', '56301', '56302'],
    retail: ['47110', '47190', '47210', '47220', '47230', '47240', '47250'],
    tech: ['62011', '62012', '62020', '62030', '62090', '63110', '63120'],
    education: ['85100', '85200', '85310', '85320', '85410', '85420'],
    logistics: ['49410', '52100', '52210', '52220', '52230', '52240', '52290'],
    realestate: ['68100', '68201', '68202', '68209', '68310', '68320'],
};

async function searchNewCompanies(query: string): Promise<CompanySearchResult[]> {
    const auth = Buffer.from(`${COMPANIES_HOUSE_API_KEY}:`).toString('base64');

    const url = `${BASE_URL}/advanced-search/companies?` + new URLSearchParams({
        incorporated_from: getDateDaysAgo(30), // Last 30 days
        incorporated_to: getDateDaysAgo(0),
        company_status: 'active',
        size: '100'
    });

    console.log(`📡 Searching newly registered companies...`);

    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${auth}`
        }
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Companies House API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.items || [];
}

async function getCompanyOfficers(companyNumber: string): Promise<Officer[]> {
    const auth = Buffer.from(`${COMPANIES_HOUSE_API_KEY}:`).toString('base64');

    const url = `${BASE_URL}/company/${companyNumber}/officers`;

    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${auth}`
        }
    });

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    return data.items || [];
}

function getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
}

function formatDirectorName(name: string): { firstName: string; lastName: string } {
    // Companies House format: "SURNAME, Firstname Middlename"
    const parts = name.split(',').map(p => p.trim());
    if (parts.length === 2) {
        const firstName = parts[1].split(' ')[0];
        const lastName = parts[0].charAt(0) + parts[0].slice(1).toLowerCase();
        return { firstName, lastName };
    }
    return { firstName: name, lastName: '' };
}

async function main() {
    console.log('🚀 UK Companies House - New Business Scraper\n');

    if (!COMPANIES_HOUSE_API_KEY) {
        console.log('❌ COMPANIES_HOUSE_API_KEY not found in .env');
        console.log('\nTo get a free API key:');
        console.log('1. Go to: https://developer.company-information.service.gov.uk/');
        console.log('2. Register for free');
        console.log('3. Create an application');
        console.log('4. Copy your API key to .env\n');
        console.log('COMPANIES_HOUSE_API_KEY=your_key_here');
        return;
    }

    console.log('🎯 Targeting: Newly registered UK companies (last 30 days)');
    console.log('📊 Industries: Restaurants, Retail, Tech, Education, Logistics, Real Estate\n');

    await leads.connect();

    try {
        const companies = await searchNewCompanies('');

        console.log(`📦 Found ${companies.length} new companies\n`);

        let saved = 0;

        for (const company of companies.slice(0, 50)) { // Limit to 50 for testing
            console.log(`\n🏢 ${company.company_name}`);
            console.log(`   Registered: ${company.date_of_creation}`);
            console.log(`   Number: ${company.company_number}`);

            // Get directors
            const officers = await getCompanyOfficers(company.company_number);
            const directors = officers.filter(o =>
                o.officer_role === 'director' || o.officer_role === 'secretary'
            );

            if (directors.length > 0) {
                const mainDirector = directors[0];
                const { firstName, lastName } = formatDirectorName(mainDirector.name);

                console.log(`   👔 Director: ${firstName} ${lastName}`);

                const address = company.registered_office_address;
                const location = [
                    address?.locality,
                    address?.postal_code
                ].filter(Boolean).join(', ');

                await leads.create({
                    firstName,
                    lastName,
                    companyName: company.company_name,
                    source: 'companies_house' as any,
                    state: 'discovered',
                    signalSummary: `new_business: UK`,
                    tags: ['new_business', 'uk', ...(company.sic_codes || [])],
                    notes: [
                        `Registered: ${company.date_of_creation}`,
                        `Company #: ${company.company_number}`,
                        `Location: ${location}`,
                        `Directors: ${directors.map(d => d.name).join(', ')}`
                    ]
                });
                saved++;
            }

            // Rate limiting - be nice to the API
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`\n📊 RESULTS`);
        console.log(`   New companies found: ${companies.length}`);
        console.log(`   Leads saved: ${saved}`);

        const stats = await leads.getStats();
        console.log(`\n📈 Total leads in DB: ${stats.total}`);

    } catch (error) {
        console.error('❌ Error:', error);
    }

    await leads.disconnect();
}

main();
