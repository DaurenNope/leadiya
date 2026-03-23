import playwright from 'playwright-core';

console.log('Testing Playwright navigation to 2GIS.kz...');

try {
  const browser = await playwright.chromium.launch({ 
    headless: true,
    args: [
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-web-security',
      '--allow-running-insecure-content'
    ]
  });
  console.log('✓ Browser launched successfully');
  
  const context = await browser.newContext({ 
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 }
  });
  console.log('✓ Context created successfully');
  
  const page = await context.newPage();
  console.log('✓ Page created successfully');
  
  console.log('Navigating to 2GIS.kz...');
  await page.goto('https://2gis.kz', { timeout: 30000, waitUntil: 'commit' });
  console.log('✓ Successfully navigated to 2GIS.kz');
  
  const url = page.url();
  console.log('Current URL:', url);
  
  const title = await page.title();
  console.log('Page title:', title);
  
  await context.close();
  await browser.close();
  console.log('✓ 2GIS.kz navigation test passed');
} catch (error) {
  console.error('✗ 2GIS.kz navigation test failed:', error.message);
  process.exit(1);
}
