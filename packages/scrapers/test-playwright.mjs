import playwright from 'playwright-core';

console.log('Testing Playwright launch...');

try {
  const browser = await playwright.chromium.launch({ headless: true });
  console.log('✓ Browser launched successfully');
  
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  console.log('✓ Context created successfully');
  
  const page = await context.newPage();
  console.log('✓ Page created successfully');
  
  await browser.close();
  console.log('✓ Playwright test passed');
} catch (error) {
  console.error('✗ Playwright test failed:', error.message);
  process.exit(1);
}
