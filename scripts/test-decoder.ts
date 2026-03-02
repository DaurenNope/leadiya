// Test the decode2GISUrl function

function decode2GISUrl(maskedUrl: string): string {
    if (!maskedUrl || !maskedUrl.includes('link.2gis.com')) {
        return maskedUrl;
    }

    try {
        const parts = maskedUrl.split('/');
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart.match(/^[A-Za-z0-9+/=]+$/)) {
            const decoded = Buffer.from(lastPart, 'base64').toString('utf-8');
            const clean = decoded.replace(/\0/g, '').trim();
            if (clean.startsWith('http')) {
                return clean;
            }
        }
    } catch {
        // Fall through
    }
    return maskedUrl;
}

// Test cases
const testUrls = [
    'https://link.2gis.com/4.2/7665ED69/aHR0cDovL2thZmVzb2Z0Lmt6Lw==',
    'https://link.2gis.com/xxx/aHR0cHM6Ly93YS5tZS83NzA3MTkzNTczMQ==',
    'https://kafesoft.kz/', // Already decoded
    'https://link.2gis.com/4.2/123abc/aHR0cHM6Ly9pbnN0YWdyYW0uY29tL3Rlc3Q=', // Instagram
];

console.log('=== Testing decode2GISUrl ===\n');

for (const url of testUrls) {
    console.log('INPUT:', url);
    console.log('OUTPUT:', decode2GISUrl(url));
    console.log('');
}
