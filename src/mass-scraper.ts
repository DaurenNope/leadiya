/**
 * Pipeline Orchestrator
 * Coordinates multiple scrapers running simultaneously.
 *
 * Usage:
 *   npx tsx src/mass-scraper.ts                     # run all scrapers
 *   npx tsx src/mass-scraper.ts --only 2gis          # only 2GIS
 *   npx tsx src/mass-scraper.ts --only kompra        # only Kompra
 *   npx tsx src/mass-scraper.ts --status              # show progress
 */

import 'dotenv/config';
import { spawn, type ChildProcess } from 'child_process';
import { createClient } from 'redis';

interface ScraperConfig {
    name: string;
    script: string;
    args: string[];
    description: string;
}

const SCRAPERS: ScraperConfig[] = [
    {
        name: '2gis',
        script: 'src/mass-2gis-scraper.ts',
        args: ['--resume'],
        description: '2GIS: All KZ cities × 90+ categories with phone reveal',
    },
    {
        name: 'kompra',
        script: 'src/mass-kompra-scraper.ts',
        args: ['--resume'],
        description: 'Kompra.kz: All OKED codes — BIN, director, phone',
    },
];

function runScraper(config: ScraperConfig): Promise<{ name: string; exitCode: number }> {
    return new Promise((resolve) => {
        console.log(`\n🚀 Starting: ${config.name} (${config.description})`);

        const proc = spawn('npx', ['tsx', config.script, ...config.args], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        // Stream stdout with prefix
        proc.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach(line => {
                console.log(`[${config.name}] ${line}`);
            });
        });

        proc.stderr.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            lines.forEach(line => {
                console.error(`[${config.name}] ⚠️ ${line}`);
            });
        });

        proc.on('close', (code) => {
            resolve({ name: config.name, exitCode: code || 0 });
        });
    });
}

async function showStatus() {
    const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redis.connect();

    console.log('═══════════════════════════════════════════════════════');
    console.log('📊 SCRAPING PROGRESS');
    console.log('═══════════════════════════════════════════════════════\n');

    // 2GIS progress
    const gis = await redis.get('scrape:2gis:progress');
    if (gis) {
        const p = JSON.parse(gis);
        console.log('🗺️  2GIS:');
        console.log(`   Jobs:    ${p.completedJobs || 0}/${p.totalJobs || '?'}`);
        console.log(`   Leads:   ${p.totalLeads || 0}`);
        if (p.byCity) {
            console.log('   By city:');
            Object.entries(p.byCity)
                .sort((a: any, b: any) => b[1] - a[1])
                .forEach(([city, count]) => console.log(`     ${city}: ${count}`));
        }
    } else {
        console.log('🗺️  2GIS: Not started');
    }

    // Kompra progress
    const kompra = await redis.get('scrape:kompra:progress');
    if (kompra) {
        const p = JSON.parse(kompra);
        console.log('\n🏛️  Kompra.kz:');
        console.log(`   OKED codes:  ${p.completed || 0}`);
        console.log(`   Total leads: ${p.total || 0}`);
    } else {
        console.log('\n🏛️  Kompra.kz: Not started');
    }

    await redis.disconnect();
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--status')) {
        await showStatus();
        return;
    }

    const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

    console.log('═══════════════════════════════════════════════════════');
    console.log('🏗️  MASS SCRAPING PIPELINE — Orchestrator');
    console.log('═══════════════════════════════════════════════════════');

    const toRun = only
        ? SCRAPERS.filter(s => s.name === only)
        : SCRAPERS;

    if (toRun.length === 0) {
        console.log(`❌ Unknown scraper: ${only}`);
        console.log(`Available: ${SCRAPERS.map(s => s.name).join(', ')}`);
        return;
    }

    console.log(`\nRunning ${toRun.length} scraper(s):`);
    toRun.forEach(s => console.log(`  • ${s.description}`));

    const startTime = Date.now();

    if (toRun.length === 1) {
        // Run single scraper inline (better output)
        const config = toRun[0];
        const result = await runScraper(config);
        console.log(`\n${result.name}: exited with code ${result.exitCode}`);
    } else {
        // Run all in parallel
        console.log('\n🔄 Running scrapers in parallel...\n');
        const results = await Promise.all(toRun.map(runScraper));

        console.log('\n═══════════════════════════════════════════════════════');
        console.log('📊 ORCHESTRATOR REPORT');
        console.log('═══════════════════════════════════════════════════════');
        results.forEach(r => {
            const icon = r.exitCode === 0 ? '✅' : '❌';
            console.log(`${icon} ${r.name}: exit code ${r.exitCode}`);
        });
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n⏱️  Total time: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);

    // Show final status
    await showStatus();
}

main().catch(err => { console.error(err); process.exit(1); });
