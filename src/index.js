'use strict';

/**
 * index.js — Programmatic API for shopvox-extractor.
 *
 * Usage:
 *   const { extract } = require('shopvox-extractor');
 *   await extract(config, { types: ['invoices', 'contacts'], csv: true });
 *
 * The config object matches the shape of shopvox.config.json.
 * All options have sensible defaults.
 */

const { loadChromeCookies } = require('./cookies');
const { launchBrowser }     = require('./browser');
const { extractAll }        = require('./extractor');
const { writeCsv }          = require('./csv');

/**
 * Run a full extraction against a ShopVox account.
 *
 * @param {object} config               Validated config (from loadConfig() or plain object).
 * @param {object} [opts]
 * @param {string[]} [opts.types]       Specific type names to extract. Omit for all.
 * @param {boolean}  [opts.csv=false]   Also write CSV files alongside JSON.
 * @param {boolean}  [opts.headless=true] Run Chrome headlessly.
 * @param {Function} [opts.log]         Custom log function. Defaults to console.log.
 * @returns {Promise<object>} Map of typeName -> record array.
 */
async function extract(config, opts = {}) {
  const {
    types    = null,
    csv      = false,
    headless = true,
    log      = console.log,
  } = opts;

  // Step 1: Load cookies from Chrome
  log('Loading Chrome cookies...');
  const cookies = loadChromeCookies();
  log(`Loaded ${cookies.length} cookies`);

  // Step 2: Launch browser and authenticate
  log('Launching browser...');
  const { browser, page } = await launchBrowser(config, cookies, { headless, log });
  log('Authenticated successfully');

  let results;
  try {
    // Step 3: Extract data
    results = await extractAll(page, config, { types, log });
  } finally {
    await browser.close();
  }

  // Step 4: Optionally write CSVs
  if (csv) {
    log('\nWriting CSV files...');
    for (const [typeName, records] of Object.entries(results)) {
      if (records.length === 0) continue;
      const csvPath = writeCsv(records, typeName, config.outputDir);
      log(`  CSV: ${csvPath}`);
    }
  }

  return results;
}

module.exports = { extract };
