/**
 * Browser test: drives the real pages in Chrome against the local preview server
 * (backend/Code.gs on the Sheets stand-in). `npm run test:ui`
 * Needs Google Chrome installed and `npm install` (playwright-core, no browser download).
 */
const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

const PORT = 8791, URL = 'http://localhost:' + PORT + '/';
const PW = 'correct-horse-1';
const results = [];
const problems = [];

async function step(name, fn) {
  try { await fn(); console.log('PASS', name); results.push('PASS  ' + name); }
  catch (e) { console.log('FAIL', name, String(e.message).split('\n')[0]); results.push('FAIL  ' + name + '\n      ' + String(e.message).split('\n')[0]); process.exitCode = 1; }
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'dev-server.js'), String(PORT), '--memory'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => server.stdout.once('data', r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  async function open(viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', e => problems.push('page error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') problems.push('console error: ' + m.text()); });
    // Outside services are stubbed so the test does not depend on the network.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route(/images\.unsplash\.com/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }));
    await page.route(/drive\.google\.com/, r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>player</p>' }));
    await page.goto(URL);
    await page.waitForSelector('.lp-nav');
    return page;
  }
  const toastText = async page => (await page.locator('.toast').last().textContent());
  async function login(page, email, password) {
    if (!(await page.locator('form[data-form=login]').isVisible())) {
      if (await page.locator('.lp-nav-actions [data-auth=login]').isVisible()) await page.click('.lp-nav-actions [data-auth=login]');
      else { await page.click('#menuBtn'); await page.click('.lp-mobile-signin'); } // phone layout
    }
    await page.fill('form[data-form=login] [name=email]', email);
    await page.fill('form[data-form=login] [name=password]', password || PW);
    await page.click('form[data-form=login] [type=submit]');
  }
  const nav = async (page, text) => { await page.click('.sidebar .nav-item:has-text("' + text + '")'); await page.waitForFunction(t => document.querySelector('.topbar h2').textContent === t, text); };
  const save = async page => { await page.click('#modal-root [type=submit]'); await page.waitForSelector('#modal-root form', { state: 'detached' }); };
  const main = page => page.locator('#main').innerText();

  const admin = await open(), client = await open(), editor = await open();

  await step('public website is the supplied design; first-time set-up creates the one Super Admin', async () => {
    assert.match(await admin.locator('.lp-hero h1').innerText(), /Videos that make people\s+stop scrolling\./);
    for (const id of ['#services', '#why-us', '#portfolio', '#contact']) assert.equal(await admin.locator(id).count(), 1);
    assert.equal(await admin.locator('.lp-service').count(), 3);
    assert.equal(await admin.evaluate(() => getComputedStyle(document.querySelector('.lp-hero h1')).fontFamily.includes('Manrope')), true);
    await admin.click('.lp-nav-actions [data-auth=login]');
    await admin.waitForSelector('form[data-form=register]'); // no Super Admin yet
    await admin.fill('[name=fullName]', 'Asha Admin'); await admin.fill('form[data-form=register] [name=email]', 'admin@sv.test');
    await admin.fill('[name=password]', PW); await admin.fill('[name=confirm]', 'different-pass');
    await admin.click('form[data-form=register] [type=submit]');
    await admin.waitForSelector('.toast.error:has-text("do not match")');
    await admin.fill('[name=confirm]', PW);
    await admin.click('form[data-form=register] [type=submit]');
    await admin.waitForSelector('.lp-form-note:has-text("You can sign in now")');
    assert.equal(await admin.locator('form[data-form=register]').count(), 0);
  });

  await step('no self-registration: Start a Project shows how to contact the studio; a wrong sign-in shows an error', async () => {
    await client.reload(); await client.waitForSelector('.lp-nav');
    await client.click('.lp-hero-cta [data-auth=register]');
    assert.match(await client.locator('.lp-modal').innerText(), /Start your project[\s\S]*send you the login details/);
    assert.equal(await client.locator('.lp-modal form').count(), 0);
    await client.click('.lp-modal [data-auth=login]');
    await client.waitForSelector('form[data-form=login]');
    assert.equal(await client.locator('form[data-form=register], .lp-auth-tabs').count(), 0);
    assert.ok(!/register/i.test(await client.locator('.lp-modal').innerText()));
    const out = await client.evaluate(async () => { try { await SV.api('register', { role: 'CLIENT', fullName: 'X', email: 'x@sv.test', password: 'long-enough-1' }); return 'created'; } catch (e) { return e.message; } });
    assert.match(out, /created by SV Workspace/);
    await login(client, 'admin@sv.test', 'wrong-password');
    await client.waitForSelector('.toast.error:has-text("Incorrect")');
    await client.keyboard.press('Escape');
    assert.equal(await client.locator('#authModal').count(), 0);
  });

  await step('Super Admin: every sidebar tab opens its own section, nothing is rendered below the dashboard', async () => {
    await login(admin, 'admin@sv.test');
    await admin.waitForSelector('.hero');
    const tabs = await admin.locator('.sidebar nav a.nav-item').allTextContents();
    const names = tabs.map(t => t.replace(/\d+$/, '').trim());
    assert.deepEqual(names, ['Overview', 'Clients', 'Videos / Projects', 'Editors & Assignments', 'Calendar', 'Budget Tracker', 'Revenue', 'Billing / Invoices', 'Video Reviews', 'Notifications', 'User Accounts', 'Pricings', 'Payment Requests', 'Reports', 'Settings / Profile']);
    for (const n of names) { await nav(admin, n); assert.ok((await main(admin)).trim().length > 20, n + ' is empty'); assert.equal(await admin.locator('#main').count(), 1); }
    assert.equal(await admin.locator('body > *:not(#app):not(#modal-root):not(#toasts):not(script):not(noscript)').count(), 0);
    await nav(admin, 'Overview');
    for (const card of ['Total Clients', 'Active Projects', 'Total Editors', 'Edits To Review', 'Monthly Revenue', 'Pending Client Payments']) assert.ok((await main(admin)).includes(card), card);
    assert.match(await admin.locator('#clock-time').textContent(), /\d/);
    await admin.click('a.stat:has-text("Total Editors")');
    await admin.waitForFunction(() => document.querySelector('.topbar h2').textContent === 'Editors & Assignments');
    assert.equal(await admin.evaluate(() => getComputedStyle(document.querySelector('.btn.primary')).borderRadius), '999px'); // the website's pill buttons
  });

  await step('User Accounts: Super Admin creates the client and the editor and gets login details to send', async () => {
    await nav(admin, 'User Accounts');
    await admin.click('[data-act=a-account-add]');
    await admin.fill('#f_fullName', 'Chitra Client'); await admin.fill('#f_email', 'client@sv.test'); await admin.fill('#f_socialName', 'chitra.creates');
    assert.ok((await admin.inputValue('#f_password')).length >= 8); // a suggested temporary password
    await admin.fill('#f_password', 'short');
    await admin.click('#modal-root [type=submit]');
    assert.match(await admin.locator('.form-error').textContent(), /at least 8 characters/);
    await admin.fill('#f_password', PW); await save(admin);
    const creds = await admin.locator('.creds').innerText();
    assert.ok(creds.includes('client@sv.test') && creds.includes(PW) && creds.includes('Website:'));
    await admin.click('#modal-root footer [data-act=dialog-close]');

    await nav(admin, 'Editors & Assignments');
    await admin.click('[data-act=a-editor-add]');
    assert.equal(await admin.inputValue('#f_role'), 'EDITOR');
    assert.equal(await admin.locator('[data-field=socialName]').isHidden(), true);
    await admin.fill('#f_fullName', 'Farid Freelance'); await admin.fill('#f_email', 'free@sv.test'); await admin.fill('#f_password', PW);
    await admin.click('#modal-root [type=submit]');
    assert.match(await admin.locator('.form-error').textContent(), /Employment type is required/);
    await admin.selectOption('#f_employmentType', 'FREELANCE');
    assert.equal(await admin.locator('[data-field=monthlySalary]').isHidden(), true);
    await admin.fill('#f_perVideoRate', '400'); await save(admin);
    await admin.waitForSelector('.creds:has-text("free@sv.test")');
    await admin.keyboard.press('Escape');
    await nav(admin, 'User Accounts');
    assert.equal(await admin.locator('#main tbody tr').count(), 3);
    assert.match(await admin.locator('tr:has-text("Farid Freelance")').innerText(), /Editor[\s\S]*Active/);
  });

  await step('C — Pricings: Super Admin saves prices; client sees them (view only)', async () => {
    await nav(admin, 'Pricings');
    await admin.fill('[name=REEL]', '0'); await admin.fill('[name=LONG]', '5000'); await admin.fill('[name=BRAND]', '8000');
    await admin.click('form[data-form=a-pricing] [type=submit]');
    await admin.waitForSelector('.toast.error:has-text("greater than zero")');
    await admin.fill('[name=REEL]', '1500');
    await admin.click('form[data-form=a-pricing] [type=submit]');
    await admin.waitForSelector('.toast:has-text("Prices saved")');
    await login(client, 'client@sv.test');
    await client.waitForSelector('.hero');
    assert.deepEqual((await client.locator('.sidebar nav .nav-item').allTextContents()).map(t => t.replace(/\d+$/, '').trim()), ['Overview', 'Status', 'Payment', 'Pricings', 'Notifications', 'Profile', 'Logout']);
    await nav(client, 'Pricings');
    const text = await main(client);
    assert.ok(text.includes('₹1,500') && text.includes('₹5,000') && text.includes('₹8,000'));
    assert.equal(await client.locator('#main input').count(), 0);
  });

  let videoId;
  await step('A — client adds a Reel: price fetched and read-only, saved as Not Started, shown at once', async () => {
    await nav(client, 'Status');
    await client.click('[data-act=c-add-video]');
    await client.click('#modal-root [type=submit]');
    assert.match(await client.locator('.form-error').textContent(), /Video Type is required/);
    await client.selectOption('#f_type', 'LONG');
    assert.equal(await client.inputValue('#f_price'), '₹5,000');
    await client.selectOption('#f_type', 'REEL');
    assert.equal(await client.inputValue('#f_price'), '₹1,500');
    assert.equal(await client.locator('#f_price').getAttribute('readonly'), '');
    await client.fill('#f_rawLink', 'not a link'); await client.fill('#f_remarks', 'Cut the pauses, add captions');
    await client.click('#modal-root [type=submit]');
    assert.match(await client.locator('.form-error').textContent(), /must be a link/);
    await client.fill('#f_rawLink', 'https://drive.google.com/file/d/raw123');
    await save(client);
    const item = client.locator('.item').first();
    videoId = (await item.locator('strong').first().textContent()).split(' ')[0];
    assert.match(videoId, /^VID-\d+$/);
    assert.match(await item.innerText(), /Not Started/);
    await nav(client, 'Notifications');
    assert.match(await main(client), /Video submitted/);
    await nav(client, 'Overview');
    assert.match((await client.locator('.stat:has-text("Total Videos") .value').textContent()), /^1$/);
  });

  await step('A — the video is in Super Admin → Videos / Projects with its client, and the admin was notified', async () => {
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Videos / Projects');
    const row = await admin.locator('tr:has-text("' + videoId + '")').innerText();
    assert.ok(row.includes('Chitra Client') && row.includes('₹1,500') && row.includes('Not Started') && row.includes('Unassigned'));
    await nav(admin, 'Notifications');
    await admin.click('.ntf:has-text("New video request")');
    await admin.waitForSelector('h3:has-text("' + videoId + '")');
  });

  await step('B — Super Admin assigns the video; the editor sees it without any client identity', async () => {
    await admin.click('[data-act=a-assign]');
    await admin.selectOption('#f_editorId', { index: 1 });
    await admin.fill('#f_deadline', '2027-01-15'); await save(admin);
    assert.match(await main(admin), /Farid Freelance/);
    await login(editor, 'free@sv.test');
    await editor.waitForSelector('.hero');
    assert.deepEqual((await editor.locator('.sidebar nav .nav-item').allTextContents()).map(t => t.replace(/\d+$/, '').trim()), ['Overview', 'My Videos', 'Payments', 'Notifications', 'Profile', 'Logout']);
    const cards = await editor.locator('.stat .label').allTextContents();
    assert.deepEqual(cards, ['Total Assigned Videos', 'Currently In Progress', 'Completed Videos']);
    await nav(editor, 'My Videos');
    const text = await main(editor);
    assert.ok(text.includes(videoId) && text.includes('https://drive.google.com/file/d/raw123') && text.includes('Cut the pauses'));
    for (const section of ['Overview', 'My Videos', 'Payments', 'Notifications', 'Profile']) {
      await nav(editor, section);
      const html = await editor.content();
      for (const secret of ['Chitra', 'chitra.creates', 'client@sv.test']) assert.ok(!html.includes(secret), section + ' shows ' + secret);
    }
  });

  await step('B — editor starts, submits a link; Super Admin gets the review request and approves; client gives final approval', async () => {
    await nav(editor, 'My Videos');
    await editor.click('[data-act=e-start]');
    await editor.waitForSelector('.badge:has-text("In Progress")');
    await editor.click('[data-act=e-submit]');
    await editor.fill('#f_link', 'https://drive.google.com/file/d/final456'); await save(editor);
    await editor.waitForSelector('.badge:has-text("In Review")');
    assert.equal(await editor.locator('[data-act=e-submit]').count(), 0);
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Notifications');
    assert.match(await main(admin), /Edited video ready for review/);
    await nav(admin, 'Video Reviews');
    await admin.click('tr:has-text("' + videoId + '") [data-act=a-review][data-decision=APPROVE]'); await save(admin);
    await client.reload(); await client.waitForSelector('.sidebar');
    await nav(client, 'Notifications');
    assert.match(await main(client), /Editing started/);
    await client.click('.ntf:has-text("ready for your approval")');
    await client.waitForSelector('.item.focus');
    assert.match(await client.locator('.item.focus').innerText(), /final456/);
    await client.click('[data-act=c-approve]'); await save(client);
    await client.waitForSelector('.badge:has-text("Completed")');
  });

  await step('C — a new price applies to new videos only', async () => {
    await nav(admin, 'Pricings');
    await admin.fill('[name=REEL]', '2000');
    await admin.click('form[data-form=a-pricing] [type=submit]');
    await admin.waitForSelector('.toast:has-text("Prices saved")');
    await client.reload(); await client.waitForSelector('.sidebar');
    await nav(client, 'Pricings');
    assert.ok((await main(client)).includes('₹2,000'));
    await nav(client, 'Status');
    await client.click('[data-act=c-add-video]');
    await client.selectOption('#f_type', 'REEL');
    assert.equal(await client.inputValue('#f_price'), '₹2,000');
    await client.fill('#f_rawLink', 'https://drive.google.com/file/d/raw789'); await client.fill('#f_remarks', 'Second video'); await save(client);
    const text = await main(client);
    assert.ok(text.includes('₹2,000') && text.includes('₹1,500'));
  });

  await step('D — client manual payment: refused until details exist, pending until verified, then the balance drops', async () => {
    await nav(client, 'Payment');
    let text = await main(client);
    assert.ok(text.includes('₹3,500'));
    assert.match(text, /Online payment is not available yet/);
    assert.equal(await client.locator('button:has-text("Pay online")').isDisabled(), true);
    assert.equal(await client.locator('[data-act=c-pay-manual]').count(), 0);
    await nav(admin, 'Settings / Profile');
    await admin.fill('[name=upiId]', 'svworkspace@upi'); await admin.fill('[name=upiName]', 'SV Workspace');
    await admin.click('form[data-form=a-settings] [type=submit]');
    await admin.waitForSelector('.toast:has-text("Payment details saved")');
    await client.reload(); await client.waitForSelector('.sidebar');
    assert.match(await main(client), /svworkspace@upi/);
    await client.click('[data-act=c-pay-manual]');
    await client.fill('#f_amount', '99999'); await client.fill('#f_reference', 'UTR12345');
    await client.click('#modal-root [type=submit]');
    assert.match(await client.locator('.form-error').textContent(), /cannot be more than/);
    await client.fill('#f_amount', '0');
    await client.click('#modal-root [type=submit]');
    assert.match(await client.locator('.form-error').textContent(), /greater than zero/);
    await client.fill('#f_amount', '2000'); await save(client);
    text = await main(client);
    assert.match(text, /Pending Verification/);
    assert.equal(await client.locator('.stat:has-text("Amount Paid") .value').textContent(), '₹0');
    assert.equal(await client.locator('.stat:has-text("Pending Amount") .value').textContent(), '₹3,500');
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Payment Requests');
    await admin.click('tr:has-text("UTR12345") [data-act=a-mp][data-decision=VERIFY]'); await save(admin);
    assert.equal(await admin.locator('tr:has-text("UTR12345") [data-act=a-mp]').count(), 0);
    await client.reload(); await client.waitForSelector('.sidebar');
    assert.equal(await client.locator('.stat:has-text("Amount Paid") .value').textContent(), '₹2,000');
    assert.equal(await client.locator('.stat:has-text("Pending Amount") .value').textContent(), '₹1,500');
    await nav(admin, 'Overview');
    assert.equal(await admin.locator('.stat:has-text("Monthly Revenue") .value').textContent(), '₹2,000');
    assert.equal(await admin.locator('.stat:has-text("Pending Client Payments") .value').textContent(), '₹1,500');
  });

  await step('Super Admin records a payment received outside the website; the client balance drops', async () => {
    await nav(admin, 'Payment Requests');
    await admin.click('[data-act=tab][data-value=client]');
    await admin.click('[data-act=a-record-pay]');
    await admin.selectOption('#f_clientId', { index: 1 });
    await admin.fill('#f_amount', '99999'); await admin.fill('#f_reference', 'Cash receipt 14');
    await admin.click('#modal-root [type=submit]');
    assert.match(await admin.locator('.form-error').textContent(), /cannot be more than what this client owes/);
    await admin.fill('#f_amount', '500'); await save(admin);
    await admin.waitForSelector('.toast:has-text("Payment recorded")');
    await client.reload(); await client.waitForSelector('.sidebar');
    assert.equal(await client.locator('.stat:has-text("Amount Paid") .value').textContent(), '₹2,500');
    assert.equal(await client.locator('.stat:has-text("Pending Amount") .value').textContent(), '₹1,000');
    assert.match(await main(client), /Cash[\s\S]*Cash receipt 14/);
    await nav(client, 'Notifications');
    assert.match(await main(client), /Payment recorded/);
    await nav(admin, 'Clients');
    await admin.click('tr:has-text("Chitra Client") a:has-text("View")'); await admin.waitForSelector('#main .back');
    assert.equal(await admin.locator('[data-act=a-record-pay]').count(), 1); // also on the client's own page
    await nav(admin, 'Overview');
    assert.equal(await admin.locator('.stat:has-text("Monthly Revenue") .value').textContent(), '₹2,500');
  });

  await step('D — editor requests payment once; Super Admin records a partial payout; the balance updates', async () => {
    await editor.reload(); await editor.waitForSelector('.sidebar');
    await nav(editor, 'Payments');
    assert.equal(await editor.locator('.stat:has-text("Pending Payment") .value').textContent(), '₹400');
    await editor.click('[data-act=e-request]');
    await editor.waitForSelector('.toast:has-text("was sent to the Super Admin")');
    assert.equal(await editor.locator('[data-act=e-request]').isDisabled(), true);
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Payment Requests');
    await admin.click('[data-act=tab][data-value=editor]');
    await admin.click('[data-act=a-req][data-decision=APPROVE]'); await save(admin);
    await admin.click('[data-act=a-payout]');
    await admin.fill('#f_amount', '900'); await admin.fill('#f_reference', 'NEFT001');
    await admin.click('#modal-root [type=submit]');
    assert.match(await admin.locator('.form-error').textContent(), /cannot be more than/);
    await admin.fill('#f_amount', '150'); await save(admin);
    await editor.reload(); await editor.waitForSelector('.sidebar');
    assert.equal(await editor.locator('.stat:has-text("Amount Received") .value').textContent(), '₹150');
    assert.equal(await editor.locator('.stat:has-text("Pending Payment") .value').textContent(), '₹250');
    assert.match(await main(editor), /NEFT001/);
    await nav(editor, 'Notifications');
    assert.match(await main(editor), /Payout recorded/);
  });

  await step('E — client edits profile and channels; Super Admin sees them under Clients → Client Details', async () => {
    await nav(client, 'Profile');
    assert.equal(await client.locator('#main [name=phone], #main [name=address], #main [name=company]').count(), 0);
    await client.fill('[name=socialName]', 'chitra.hd');
    await client.setInputFiles('input[data-photo]', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC', 'base64') });
    await client.waitForSelector('#photo-preview img');
    await client.click('form[data-form=profile] [type=submit]');
    await client.waitForSelector('.toast:has-text("Profile saved")');
    await client.click('[data-act=c-channel]:has-text("Add Your Channels")');
    await client.fill('#f_name', 'Chitra Creates'); await client.fill('#f_link', 'https://youtube.com/@chitra'); await save(client);
    await client.click('[data-act=c-channel]:has-text("Add Your Channels")');
    await client.selectOption('#f_platform', 'INSTAGRAM'); await client.fill('#f_name', 'chitra.insta'); await client.fill('#f_link', 'https://instagram.com/chitra'); await save(client);
    await client.click('tr:has-text("Chitra Creates") [data-act=c-channel]');
    await client.fill('#f_name', 'Chitra Creates HD'); await save(client);
    await client.click('tr:has-text("chitra.insta") [data-act=c-channel-del]'); await save(client);
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Clients');
    await admin.click('tr:has-text("Chitra Client") a:has-text("View")'); await admin.waitForSelector('#main .back');
    const text = await main(admin);
    assert.ok(text.includes('chitra.hd') && text.includes('Chitra Creates HD') && !text.includes('chitra.insta'));
    assert.equal(await admin.locator('.panel-head img.avatar').count(), 1);
    for (const tab of ['Projects', 'Payments', 'Invoices', 'Profile']) { await admin.click('.subtabs button:has-text("' + tab + '")'); assert.ok((await main(admin)).length > 50); }
  });

  await step('E — editor changes name, email and photo; Super Admin sees them; pay fields are view-only', async () => {
    await nav(editor, 'Profile');
    assert.equal(await editor.locator('#main [name=perVideoRate], #main [name=employmentType], #main [name=monthlySalary]').count(), 0);
    assert.match(await main(editor), /Freelance[\s\S]*₹400/);
    await editor.fill('[name=fullName]', 'Farid F.'); await editor.fill('form[data-form=profile] [name=email]', 'admin@sv.test');
    await editor.click('form[data-form=profile] [type=submit]');
    await editor.waitForSelector('.toast.error:has-text("Another account already uses")');
    await editor.fill('form[data-form=profile] [name=email]', 'farid.new@sv.test');
    await editor.setInputFiles('input[data-photo]', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAEklEQVR42mNk+M9Qz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC', 'base64') });
    await editor.waitForSelector('#photo-preview img');
    await editor.click('form[data-form=profile] [type=submit]');
    await editor.waitForSelector('.toast:has-text("Profile saved")');
    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Editors & Assignments');
    await admin.click('tr:has-text("Farid F.") a:has-text("View")'); await admin.waitForSelector('#main .back');
    assert.match(await main(admin), /farid\.new@sv\.test/);
    assert.equal(await admin.locator('.panel-head img.avatar').count(), 1);
  });

  await step('review tools: timecoded comments, team-only notes, in-page preview, project board', async () => {
    await nav(client, 'Status');
    const card = client.locator('.item:has-text("Second video")');
    const second = (await card.locator('strong').first().textContent()).split(' ')[0];
    assert.equal(await card.locator('.steps li.current').textContent(), 'Submitted');
    await card.locator('[name=timecode]').fill('abc'); await card.locator('[name=text]').fill('Trim this pause');
    await card.locator('form[data-form=comment] [type=submit]').click();
    await client.waitForSelector('.toast.error:has-text("Timecode")');
    await client.locator('.item:has-text("Second video") [name=timecode]').fill('0:42');
    await client.locator('.item:has-text("Second video") form[data-form=comment] [type=submit]').click();
    await client.waitForSelector('.comment.mine:has-text("Trim this pause")');
    assert.equal(await client.locator('.comment.mine .tc').textContent(), '0:42');

    await admin.reload(); await admin.waitForSelector('.sidebar');
    await nav(admin, 'Videos / Projects');
    await admin.click('.subtabs button:has-text("Board")');
    assert.equal(await admin.locator('.kcard').count(), 2);
    assert.equal(await admin.locator('.kcol').count(), 6);
    await admin.click('.kcard:has-text("' + second + '")');
    await admin.waitForSelector('h3:has-text("' + second + '")');
    assert.match(await admin.locator('.comment').innerText(), /Chitra Client \(Client\)[\s\S]*Trim this pause/);
    await admin.fill('form[data-form=comment] [name=text]', 'Use the brand LUT');
    await admin.selectOption('form[data-form=comment] [name=audience]', 'INTERNAL');
    await admin.click('form[data-form=comment] [type=submit]');
    await admin.waitForSelector('.comment.mine:has-text("Use the brand LUT")');
    await admin.click('[data-act=preview]');
    assert.equal(await admin.locator('iframe.player').getAttribute('src'), 'https://drive.google.com/file/d/raw789/preview');
    await admin.keyboard.press('Escape');
    await admin.waitForSelector('#modal-root .modal', { state: 'detached' });
    await nav(admin, 'Videos / Projects');
    await admin.click('.subtabs button:has-text("List")');

    await client.reload(); await client.waitForSelector('.sidebar');
    assert.equal(await client.locator('.item:has-text("Second video") .comment').count(), 1); // the team-only note is not sent to the client
    assert.ok(!(await client.content()).includes('brand LUT'));
  });

  await step('search palette, dark theme, notification popover and printable invoice', async () => {
    await admin.keyboard.press('Control+k');
    await admin.fill('#palette-q', 'chitra');
    assert.match(await admin.locator('.palette-item').first().innerText(), /Chitra Client/);
    await admin.keyboard.press('Enter');
    await admin.waitForSelector('#main .back');
    assert.equal(await admin.locator('.topbar h2').textContent(), 'Clients');
    await admin.click('[data-act=palette]'); await admin.fill('#palette-q', 'zzzz');
    assert.match(await admin.locator('#palette-list').innerText(), /Nothing matches/);
    await admin.keyboard.press('Escape');

    await admin.click('[data-act=theme]');
    assert.equal(await admin.evaluate(() => document.documentElement.dataset.theme), 'dark');
    const dark = await admin.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await admin.reload(); await admin.waitForSelector('.sidebar');
    assert.equal(await admin.evaluate(() => getComputedStyle(document.body).backgroundColor), dark); // remembered
    await admin.click('[data-act=theme]');
    assert.equal(await admin.evaluate(() => document.documentElement.dataset.theme), 'light');

    assert.equal(await admin.locator('#bell-pop').isHidden(), true);
    await admin.click('[data-act=bell]');
    assert.equal(await admin.locator('#bell-pop').isVisible(), true);
    assert.ok(await admin.locator('#bell-pop .pnt').count() > 0);
    await admin.click('#main');
    assert.equal(await admin.locator('#bell-pop').isHidden(), true);

    await nav(client, 'Payment');
    await client.click('[data-act=c-invoice] >> nth=0');
    const invoice = await client.locator('.invoice').innerText();
    assert.ok(/INV-0001/.test(invoice) && /Chitra Client/.test(invoice) && /Balance due/.test(invoice) && /Paid/.test(invoice));
    await client.click('#modal-root footer [data-act=dialog-close]');
    await nav(admin, 'Billing / Invoices');
    await admin.click('[data-act=a-invoice] >> nth=0');
    await admin.waitForSelector('.invoice [class=inv-total]');
    await admin.keyboard.press('Escape');
    await nav(admin, 'Overview');
    assert.equal(await admin.locator('.bars .bar').count(), 6);
    assert.equal(await admin.locator('.hbar').count(), 6);
  });

  await step('search and filters narrow the lists', async () => {
    await nav(admin, 'Videos / Projects');
    assert.equal(await admin.locator('#main tbody tr').count(), 2);
    await admin.selectOption('[data-f=videoStatus]', 'COMPLETED');
    assert.equal(await admin.locator('#main tbody tr').count(), 1);
    await admin.selectOption('[data-f=videoStatus]', '');
    await admin.fill('[data-f=videoQ]', 'no such video');
    assert.match(await main(admin), /No videos match these filters/);
    await admin.fill('[data-f=videoQ]', '');
    await nav(admin, 'Clients');
    await admin.fill('[data-f=clientQ]', 'chitra.hd');
    assert.equal(await admin.locator('#main tbody tr').count(), 1);
    await admin.fill('[data-f=clientQ]', '');
  });

  await step('F — reload keeps the session and the section; a role cannot open another role\'s section; logout works', async () => {
    await nav(client, 'Payment');
    await client.reload(); await client.waitForSelector('.sidebar');
    assert.equal(await client.locator('.topbar h2').textContent(), 'Payment');
    await client.goto(URL + '#/approvals'); await client.reload(); await client.waitForSelector('.sidebar');
    assert.equal(await client.locator('.topbar h2').textContent(), 'Overview');
    const out = await client.evaluate(async () => { try { await SV.api('admin.savePricing', { prices: { REEL: '1', LONG: '1', BRAND: '1' } }); return 'allowed'; } catch (e) { return e.message; } });
    assert.match(out, /not allowed/);
    const token = await client.evaluate(() => localStorage.getItem('sv_workspace_token'));
    await client.click('[data-act=logout]');
    await client.waitForSelector('.lp-nav');
    assert.equal(await client.evaluate(() => localStorage.getItem('sv_workspace_token')), null);
    const dead = await client.evaluate(async t => (await (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'state', token: t }) })).json()).code, token);
    assert.equal(dead, 'AUTH');
    await client.reload(); await client.waitForSelector('.lp-nav');
  });

  await step('suspended client is signed out and cannot sign in; history is kept', async () => {
    await login(client, 'client@sv.test'); await client.waitForSelector('.sidebar');
    await nav(admin, 'Clients');
    await admin.click('tr:has-text("Chitra Client") a:has-text("View")'); await admin.waitForSelector('#main .back');
    await admin.click('[data-act=a-user-status][data-status=SUSPENDED]'); await save(admin);
    await admin.click('.subtabs button:has-text("Projects")');
    assert.equal(await admin.locator('#main tbody tr').count(), 2);
    await nav(client, 'Status').catch(() => {});
    await client.reload(); await client.waitForSelector('.lp-nav');
    await login(client, 'client@sv.test');
    await client.waitForSelector('.toast.error:has-text("suspended")');
  });

  await step('mobile: the sidebar opens from the menu button and closes after choosing a section', async () => {
    const m = await open({ width: 390, height: 800 });
    await login(m, 'farid.new@sv.test'); await m.waitForSelector('.hero');
    const offscreen = async () => (await m.locator('.sidebar').boundingBox()).x < 0;
    assert.equal(await offscreen(), true);
    await m.click('.menu-btn'); await m.waitForTimeout(300);
    assert.equal(await offscreen(), false);
    await m.click('.sidebar .nav-item:has-text("My Videos")'); await m.waitForTimeout(300);
    assert.equal(await m.locator('.topbar h2').textContent(), 'My Videos');
    assert.equal(await offscreen(), true);
    assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await m.context().close();
  });

  await step('no JavaScript errors were logged in any page', async () => { if (problems.length) console.log(problems.slice(0, 8).join(' | ')); assert.deepEqual(problems, []); });

  await browser.close();
  server.kill();
  console.log(results.join('\n'));
  console.log('\n' + results.filter(r => r.startsWith('PASS')).length + ' passed, ' + results.filter(r => r.startsWith('FAIL')).length + ' failed');
}
main().catch(e => { console.error(e); process.exit(1); });
