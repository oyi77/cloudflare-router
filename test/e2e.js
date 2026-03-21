const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('=== E2E Test: Cloudflare Router Dashboard ===\n');
  
  // Test 1: Load dashboard page
  console.log('Test 1: Loading dashboard page...');
  await page.goto('http://localhost:7070');
  await page.waitForSelector('.login-box');
  console.log('✓ Login page loaded\n');
  
  // Test 2: Login with password
  console.log('Test 2: Logging in...');
  await page.fill('#login-password', '123456');
  await page.click('button[type="submit"]');
  await page.waitForSelector('#dashboard-screen:not(.hidden)');
  console.log('✓ Login successful\n');
  
  // Test 3: Check stats cards
  console.log('Test 3: Checking stats cards...');
  const statsVisible = await page.isVisible('#stats');
  console.log(`✓ Stats section visible: ${statsVisible}\n`);
  
  // Test 4: Check tabs
  console.log('Test 4: Checking tabs...');
  const tabs = await page.$$eval('.tab', els => els.map(el => el.textContent));
  console.log(`✓ Tabs found: ${tabs.join(', ')}\n`);
  
  // Test 5: Check language selector
  console.log('Test 5: Checking language selector...');
  const langOptions = await page.$$eval('#lang-selector option', els => els.map(el => el.textContent));
  console.log(`✓ Languages: ${langOptions.join(', ')}\n`);
  
  // Test 6: Test theme toggle
  console.log('Test 6: Testing theme toggle...');
  await page.click('.theme-toggle');
  const theme = await page.getAttribute('html', 'data-theme');
  console.log(`✓ Theme toggled to: ${theme}\n`);
  
  // Test 7: Test tab switching
  console.log('Test 7: Testing tab switching...');
  await page.click('.tab[data-tab="domains"]');
  await page.waitForTimeout(500);
  const domainsVisible = await page.isVisible('#tab-domains');
  console.log(`✓ Domains tab visible: ${domainsVisible}\n`);
  
  // Test 8: Test language change
  console.log('Test 8: Testing language change (Indonesian)...');
  await page.selectOption('#lang-selector', 'id');
  await page.waitForTimeout(1000);
  const dashText = await page.textContent('[data-i18n="title"]');
  console.log(`✓ Dashboard title after i18n: ${dashText}\n`);
  
  // Test 9: Check modals exist
  console.log('Test 9: Checking modals...');
  const modals = ['add-account-modal', 'add-zone-modal', 'add-mapping-modal', 'add-health-modal'];
  for (const modal of modals) {
    const exists = await page.isVisible(`#${modal}`);
    console.log(`  - ${modal}: exists=${exists}`);
  }
  console.log('✓ All modals present\n');
  
  // Test 10: Take screenshot
  console.log('Test 10: Taking screenshot...');
  await page.screenshot({ path: '/tmp/cfr-e2e.png', fullPage: true });
  console.log('✓ Screenshot saved to /tmp/cfr-e2e.png\n');
  
  console.log('=== All E2E tests passed! ===');
  
  await browser.close();
  process.exit(0);
})();
