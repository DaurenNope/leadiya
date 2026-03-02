/**
 * Scraper Registry
 * Manages available scrapers and their execution
 */

import { spawn, type ChildProcess } from 'child_process';

interface ScraperConfig {
    name: string;
    displayName: string;
    description: string;
    file: string;
    params?: {
        name: string;
        type: 'string' | 'number' | 'select';
        label: string;
        options?: string[];
        default?: string;
    }[];
}

// Registry of available scrapers
export const SCRAPERS: ScraperConfig[] = [
    {
        name: '2gis',
        displayName: '2GIS Almaty',
        description: 'Kazakhstan business directory',
        file: 'src/2gis-scraper.ts',
        params: [
            { name: 'query', type: 'string', label: 'Search query', default: 'оптом' },
            { name: 'city', type: 'string', label: 'City', default: 'almaty' }
        ]
    },
    {
        name: 'kompra',
        displayName: 'Kompra.kz',
        description: 'Kazakhstan company registry with directors',
        file: 'src/scrape-kompra.ts'
    },
    {
        name: 'apollo',
        displayName: 'Apollo.io',
        description: 'B2B contact database',
        file: 'src/apollo-scraper.ts'
    },
    {
        name: 'yandex',
        displayName: 'Yandex Maps',
        description: 'Russian/CIS business listings',
        file: 'src/yandex-maps-scraper.ts'
    },
    {
        name: 'rusprofile',
        displayName: 'RusProfile',
        description: 'Russian company registry',
        file: 'src/rusprofile-scraper.ts'
    },
    {
        name: 'headhunter',
        displayName: 'HeadHunter',
        description: 'Job-based company discovery',
        file: 'src/headhunter-scraper.ts'
    },
    {
        name: 'clutch',
        displayName: 'Clutch.co',
        description: 'B2B agency directory',
        file: 'src/clutch-scraper.ts'
    },
    {
        name: 'vcru',
        displayName: 'VC.ru',
        description: 'Russian tech news commenters',
        file: 'src/vcru-scraper.ts'
    },
    {
        name: 'zoon',
        displayName: 'Zoon',
        description: 'Russian/CIS business reviews',
        file: 'src/zoon-scraper.ts'
    }
];

// Active scraper processes
const activeProcesses = new Map<string, {
    process: ChildProcess;
    output: string[];
    startedAt: Date;
    status: 'running' | 'completed' | 'error';
}>();

/**
 * Get list of all scrapers
 */
export function listScrapers(): ScraperConfig[] {
    return SCRAPERS;
}

/**
 * Get scraper by name
 */
export function getScraper(name: string): ScraperConfig | undefined {
    return SCRAPERS.find(s => s.name === name);
}

/**
 * Run a scraper
 */
export function runScraper(name: string, params?: Record<string, string>): {
    success: boolean;
    runId?: string;
    error?: string;
} {
    const scraper = getScraper(name);
    if (!scraper) {
        return { success: false, error: `Scraper not found: ${name}` };
    }

    const runId = `${name}_${Date.now()}`;
    const env = { ...process.env, ...params };

    try {
        const proc = spawn('npx', ['tsx', scraper.file], {
            cwd: process.cwd(),
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const output: string[] = [];

        proc.stdout?.on('data', (data) => {
            const lines = data.toString().split('\n').filter((l: string) => l.trim());
            output.push(...lines);
            // Keep only last 100 lines
            if (output.length > 100) output.splice(0, output.length - 100);
        });

        proc.stderr?.on('data', (data) => {
            output.push(`[ERROR] ${data.toString()}`);
        });

        proc.on('close', (code) => {
            const entry = activeProcesses.get(runId);
            if (entry) {
                entry.status = code === 0 ? 'completed' : 'error';
            }
        });

        activeProcesses.set(runId, {
            process: proc,
            output,
            startedAt: new Date(),
            status: 'running'
        });

        return { success: true, runId };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start scraper'
        };
    }
}

/**
 * Get scraper run status
 */
export function getScraperStatus(runId: string): {
    status: string;
    output: string[];
    startedAt?: Date;
} | null {
    const entry = activeProcesses.get(runId);
    if (!entry) return null;

    return {
        status: entry.status,
        output: entry.output.slice(-30), // Last 30 lines
        startedAt: entry.startedAt
    };
}

/**
 * Stop a running scraper
 */
export function stopScraper(runId: string): boolean {
    const entry = activeProcesses.get(runId);
    if (!entry || entry.status !== 'running') return false;

    entry.process.kill();
    entry.status = 'completed';
    return true;
}
