'use strict';

/**
 * browser.js — Launch a Puppeteer browser, inject cookies, and verify auth.
 *
 * Strategy:
 *   1. Launch Chrome (headless by default, headed if needed for MFA).
 *   2. Inject all shopvox.com cookies from the user's Chrome profile.
 *   3. Navigate to the ShopVox SPA. If the session is still valid, we land
 *      on the app. If not, fall back to credential login.
 *   4. Return the authenticated page so callers can make API calls.
 */

const puppeteer = require('puppeteer-core');

const SPA_URL    = 'https://express.shopvox.com/transactions/invoices';
const SIGNIN_URL = 'https://express.shopvox.com/sign-in';

/**
 * Launch Chrome and return an authenticated Puppeteer page.
 *
 * @param {object} config   Validated config from loadConfig().
 * @param {object[]} cookies Decrypted cookies from loadChromeCookies().
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]  Run Chrome headlessly.
 * @param {Function} [opts.log]           Optional log function.
 * @returns {{ browser: Browser, page: Page }}
 */
async function launchBrowser(config, cookies, opts = {}) {
  const { headless = true, log = () => {} } = opts;

  const browser = await puppeteer.launch({
    headless,
    executablePath: config.chromePath,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();

  // Suppress console noise from the SPA
  page.on('console', () => {});
  page.on('pageerror', () => {});

  // Inject cookies before any navigation so they are present on first request
  await injectCookies(page, cookies);

  log('Navigating to ShopVox SPA to verify session...');
  try {
    await page.goto(SPA_URL, { waitUntil: 'networkidle2', timeout: 45_000 });
  } catch (err) {
    // networkidle2 can time out on slow SPAs; check URL regardless
    if (!page.url().startsWith('https://express.shopvox.com')) {
      throw new Error(`Navigation failed: ${err.message}`);
    }
  }

  const currentUrl = page.url();

  if (currentUrl.includes('sign-in') || currentUrl.includes('login')) {
    log('Session expired or cookies invalid — attempting credential login...');
    await credentialLogin(page, config, log);
  } else {
    log('Session cookie valid — already authenticated.');
  }

  return { browser, page };
}

/**
 * Inject an array of cookie objects into a Puppeteer page.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object[]} cookies
 */
async function injectCookies(page, cookies) {
  for (const c of cookies) {
    try {
      await page.setCookie({
        name:     c.name,
        value:    c.value,
        domain:   c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path:     c.path || '/',
        expires:  c.expires != null ? Math.floor(c.expires) : undefined,
        httpOnly: c.httpOnly,
        secure:   c.secure,
        sameSite: c.sameSite,
      });
    } catch {
      // Individual cookie errors (e.g. invalid domain format) are non-fatal
    }
  }
}

/**
 * Log in using email + password credentials.
 * Used as a fallback when the cookie session has expired.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object} config
 * @param {Function} log
 */
async function credentialLogin(page, config, log) {
  await page.goto(SIGNIN_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

  // Small delay for SPA to render the form
  await new Promise(r => setTimeout(r, 1_000));

  // Fill email field — try multiple common selectors
  const emailSelectors = [
    'input[name="email"]',
    'input[type="email"]',
    '#email',
    'input[placeholder*="email" i]',
  ];
  for (const sel of emailSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click({ clickCount: 3 }); // clear existing value
      await el.type(config.email, { delay: 40 });
      break;
    }
  }

  // Fill password field
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    '#password',
  ];
  for (const sel of passwordSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click({ clickCount: 3 });
      await el.type(config.password, { delay: 40 });
      break;
    }
  }

  // Submit
  const submitBtn = await page.$('button[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
  } else {
    // Fallback: press Enter in the password field
    await page.keyboard.press('Enter');
  }

  // Wait for redirect away from sign-in (up to 30 s)
  log('Waiting for login redirect...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1_000));
    if (!page.url().includes('sign-in') && !page.url().includes('login')) break;
  }

  if (page.url().includes('sign-in') || page.url().includes('login')) {
    throw new Error(
      'Login failed — still on sign-in page after 30 s.\n' +
      'Check your email/password in shopvox.config.json.\n' +
      'If MFA is required, open Chrome manually and log in, then re-run.'
    );
  }

  log('Credential login succeeded.');

  // Re-navigate to ensure the SPA is fully loaded
  try {
    await page.goto(SPA_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  } catch {
    // Non-fatal; page may already be at a valid URL
  }
}

module.exports = { launchBrowser };
