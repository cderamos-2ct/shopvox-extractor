'use strict';

/**
 * cookies.js — macOS Chrome cookie decryption via Python helper.
 *
 * Chrome on macOS stores cookie values encrypted with AES-128-CBC v10.
 * The decryption key is derived from a password stored in macOS Keychain
 * ("Chrome Safe Storage") via PBKDF2-SHA1.
 *
 * Because Node.js cannot directly access the macOS Keychain via the
 * `security` CLI without extra native bindings, we delegate decryption to
 * the bundled Python script (scripts/decrypt_cookies.py), which is executed
 * as a child process and returns JSON on stdout.
 *
 * The Python script requires: pip3 install cryptography
 */

const { execSync } = require('child_process');
const path         = require('path');
const fs           = require('fs');

// Path to the bundled Python script, relative to this file
const PYTHON_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'decrypt_cookies.py');

/**
 * Load shopvox.com cookies from the user's Chrome profile by running the
 * Python decryption helper.
 *
 * @returns {object[]} Array of cookie objects in Puppeteer setCookie format.
 * @throws {Error} If Python is not available, cryptography is not installed,
 *                 or the script returns an error.
 */
function loadChromeCookies() {
  if (!fs.existsSync(PYTHON_SCRIPT)) {
    throw new Error(
      `Cookie decryption script not found at:\n  ${PYTHON_SCRIPT}\n` +
      'The package may be corrupted — try reinstalling.'
    );
  }

  let stdout;
  try {
    stdout = execSync(`python3 "${PYTHON_SCRIPT}"`, {
      encoding: 'utf8',
      // Capture both streams; stderr is shown only on error
      stdio: ['pipe', 'pipe', 'pipe'],
      // Give it up to 30 s — Keychain prompt may take a moment
      timeout: 30_000,
    });
  } catch (err) {
    const detail = err.stderr ? err.stderr.trim() : err.message;
    throw new Error(
      `Cookie decryption failed.\n\n` +
      `${detail}\n\n` +
      `Ensure Python 3 and the cryptography package are installed:\n` +
      `  pip3 install cryptography`
    );
  }

  let cookies;
  try {
    cookies = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Cookie decryption script returned unexpected output:\n${stdout.slice(0, 500)}`
    );
  }

  if (!Array.isArray(cookies)) {
    throw new Error('Cookie decryption script did not return an array.');
  }

  return cookies;
}

/**
 * Inject an array of cookie objects into a Puppeteer page.
 *
 * Handles domain normalisation (Puppeteer requires a leading dot for
 * host-scope cookies when the domain does not already have one).
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
        // Puppeteer expects host-scope cookies to start with a dot
        domain:   c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path:     c.path || '/',
        expires:  c.expires != null ? Math.floor(c.expires) : undefined,
        httpOnly: c.httpOnly,
        secure:   c.secure,
        sameSite: c.sameSite,
      });
    } catch {
      // Individual cookie failures (e.g. invalid domain) are non-fatal
    }
  }
}

module.exports = { loadChromeCookies, injectCookies };
