'use strict';

/**
 * pdf.js — PDF downloader for ShopVox transaction records.
 *
 * Strategy:
 *   Phase 1 — Use the list API (same as extractor.js) to discover ALL record
 *              IDs. This avoids the "filtered view" problem of DOM scraping.
 *
 *   Phase 2 — For each ID, navigate to the record's detail page in the browser,
 *              find the PDF download button, and trigger a download via Alt+click.
 *              The CDP Page.setDownloadBehavior directive routes files to disk.
 *
 * NOTE: PDF downloading requires a visible (non-headless) browser window because
 * Chrome's PDF viewer and download interception behave differently in headless
 * mode. The browser is always launched headed for this command.
 */

const fs   = require('fs');
const path = require('path');

const API_BASE = 'https://api.shopvox.com';
const SPA_BASE = 'https://express.shopvox.com';
const PER_PAGE = 50;

/**
 * Transaction types that have downloadable PDFs.
 * listApi  — API endpoint used to discover all record IDs.
 * arrayKey — JSON key containing the records array in list API responses.
 * spaPath  — URL path prefix in the ShopVox SPA (for building record page URLs).
 */
const PDF_TYPES = [
  {
    name:     'quotes',
    listApi:  `${API_BASE}/edge/transactions/quotes`,
    arrayKey: 'quotes',
    spaPath:  `${SPA_BASE}/transactions/quotes`,
  },
  {
    name:     'sales-orders',
    listApi:  `${API_BASE}/edge/transactions/work_orders`,
    arrayKey: 'workOrders',
    spaPath:  `${SPA_BASE}/transactions/sales-orders`,
  },
  {
    name:     'invoices',
    listApi:  `${API_BASE}/edge/transactions/invoices`,
    arrayKey: 'invoices',
    spaPath:  `${SPA_BASE}/transactions/invoices`,
  },
  {
    name:     'payments',
    listApi:  `${API_BASE}/edge/transactions/payments`,
    arrayKey: 'payments',
    spaPath:  `${SPA_BASE}/transactions/payments`,
  },
  {
    name:     'purchase-orders',
    listApi:  `${API_BASE}/edge/transactions/purchase_orders`,
    arrayKey: 'purchaseOrders',
    spaPath:  `${SPA_BASE}/transactions/purchase-orders`,
  },
  {
    name:     'credit-memos',
    listApi:  `${API_BASE}/edge/transactions/credit_memos`,
    arrayKey: 'creditMemos',
    spaPath:  `${SPA_BASE}/transactions/credit-memos`,
  },
  {
    name:     'refunds',
    listApi:  `${API_BASE}/edge/transactions/refunds`,
    arrayKey: 'refunds',
    spaPath:  `${SPA_BASE}/transactions/refunds`,
  },
];

// PDF download button selectors, tried in order
const DOWNLOAD_SELECTORS = [
  'a.css-ugn94p',
  'a[download]',
  'a[href$=".pdf"]',
  '[aria-label*="download" i]',
  '[aria-label*="pdf" i]',
  '[class*="download"]',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Load already-downloaded record IDs from the progress log.
 * The log lives at <outputDir>/pdfs/<typeName>/.downloaded
 *
 * @param {string} typeDir
 * @returns {Set<string>}
 */
function loadDownloaded(typeDir) {
  const logPath = path.join(typeDir, '.downloaded');
  if (!fs.existsSync(logPath)) return new Set();
  return new Set(
    fs.readFileSync(logPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
  );
}

/**
 * Record a successfully downloaded ID to the progress log.
 *
 * @param {string} typeDir
 * @param {string} id
 */
function markDownloaded(typeDir, id) {
  fs.appendFileSync(path.join(typeDir, '.downloaded'), `${id}\n`);
}

// ── Phase 1: ID collection (identical strategy to extractor.js) ──────────────

/**
 * Paginate the list API inside the browser to collect all record IDs.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object} type  Entry from PDF_TYPES.
 * @param {Function} log
 * @returns {Promise<string[]>}
 */
async function collectAllIds(page, type, log) {
  log(`  Discovering all IDs via API: ${type.listApi}`);
  const ids = [];

  for (let pageNum = 1; pageNum <= 9_999; pageNum++) {
    const url = `${type.listApi}?page=${pageNum}&perPage=${PER_PAGE}`;

    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        if (!res.ok) return { __error: res.status };
        return { __data: await res.json() };
      } catch (e) {
        return { __error: e.message };
      }
    }, url);

    if (result.__error) {
      log(`  Page ${pageNum}: API error ${result.__error} — stopping`);
      break;
    }

    const arr = result.__data[type.arrayKey];
    if (!Array.isArray(arr) || arr.length === 0) {
      log(`  Page ${pageNum}: done (${ids.length} total IDs)`);
      break;
    }

    for (const rec of arr) {
      if (rec.id) ids.push(String(rec.id));
    }

    log(`  Page ${pageNum}: +${arr.length} (total ${ids.length})`);

    if (!result.__data.meta?.hasNextPage) {
      log(`  No more pages — ${ids.length} IDs total`);
      break;
    }
  }

  return ids;
}

// ── Phase 2: PDF download ─────────────────────────────────────────────────────

/**
 * Navigate to a record's detail page and trigger the PDF download.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} recordUrl   Full URL of the record detail page.
 * @returns {Promise<boolean>} true if a download was triggered, false otherwise.
 */
async function triggerPdfDownload(page, recordUrl) {
  try {
    await page.goto(recordUrl, { waitUntil: 'networkidle2', timeout: 45_000 });
  } catch (err) {
    // networkidle2 timeout on slow pages — proceed anyway
    if (!page.url().includes(recordUrl.split('/').pop())) {
      throw err;
    }
  }

  // Brief wait for any deferred rendering
  await new Promise(r => setTimeout(r, 1_000));

  for (const sel of DOWNLOAD_SELECTORS) {
    const el = await page.$(sel);
    if (!el) continue;

    const box = await el.boundingBox();
    if (!box) continue;

    const cx = box.x + box.width  / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    // Alt+click triggers "Save Link As" / download in Chrome
    await page.keyboard.down('Alt');
    await page.mouse.click(cx, cy);
    await page.keyboard.up('Alt');

    // Wait for the download to start
    await new Promise(r => setTimeout(r, 4_000));
    return true;
  }

  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Download PDFs for the given transaction types.
 *
 * @param {import('puppeteer-core').Browser} browser  Running Puppeteer browser.
 * @param {import('puppeteer-core').Page}    page     Authenticated page.
 * @param {object}   config               Validated config (outputDir, etc.).
 * @param {object}   [opts]
 * @param {string[]} [opts.types]         Type names to process. Defaults to all.
 * @param {Function} [opts.log]           Log function.
 * @returns {Promise<object>} Summary map: typeName -> { total, downloaded, skipped }
 */
async function downloadPdfs(browser, page, config, opts = {}) {
  const {
    types: typeFilter = null,
    log = console.log,
  } = opts;

  const pdfsDir = path.join(config.outputDir, 'pdfs');
  ensureDir(pdfsDir);

  const typesToRun = typeFilter
    ? PDF_TYPES.filter(t => typeFilter.includes(t.name))
    : PDF_TYPES;

  if (typesToRun.length === 0) {
    const valid = PDF_TYPES.map(t => t.name).join(', ');
    throw new Error(`No matching PDF types. Valid types: ${valid}`);
  }

  // Get CDP session for download path control
  const client = await page.createCDPSession();

  const summary = {};

  for (const type of typesToRun) {
    log(`\n${'='.repeat(50)}`);
    log(`PDF download: ${type.name}`);
    log('='.repeat(50));

    const typeDir = path.join(pdfsDir, type.name);
    ensureDir(typeDir);

    // Route all downloads for this type into its folder
    await client.send('Page.setDownloadBehavior', {
      behavior:     'allow',
      downloadPath: typeDir,
    });

    // Load progress so we can resume
    const downloaded = loadDownloaded(typeDir);
    log(`  ${downloaded.size} already downloaded — will skip`);

    // Phase 1: Discover all IDs
    const allIds = await collectAllIds(page, type, log);
    log(`  ${allIds.length} total records found`);

    if (allIds.length === 0) {
      log(`  No records — skipping ${type.name}`);
      summary[type.name] = { total: 0, downloaded: 0, skipped: 0 };
      continue;
    }

    const pending = allIds.filter(id => !downloaded.has(id));
    log(`  ${pending.length} to download (${downloaded.size} already done)`);

    let dlCount = 0;
    let skipCount = 0;

    // Phase 2: Download each record
    for (let i = 0; i < pending.length; i++) {
      const id        = pending[i];
      const recordUrl = `${type.spaPath}/${id}`;

      log(`  [${i + 1}/${pending.length}] ${id}`);

      try {
        const ok = await triggerPdfDownload(page, recordUrl);
        if (ok) {
          markDownloaded(typeDir, id);
          dlCount++;
          log(`    ✓ downloaded`);
        } else {
          log(`    — no PDF link found (skipping)`);
          skipCount++;
        }
      } catch (err) {
        log(`    ✗ error: ${err.message.split('\n')[0]} (skipping)`);
        skipCount++;
      }

      // Return to a neutral page between records to avoid stale state
      try {
        await page.goto(`${SPA_BASE}/transactions/${type.name}`, {
          waitUntil: 'domcontentloaded',
          timeout:   20_000,
        });
      } catch { /* non-fatal */ }

      await new Promise(r => setTimeout(r, 1_000));
    }

    summary[type.name] = {
      total:      allIds.length,
      downloaded: dlCount,
      skipped:    skipCount,
    };

    log(`  ✓ ${type.name}: ${dlCount} downloaded, ${skipCount} skipped`);
    log(`  PDFs saved to: ${typeDir}`);
  }

  return summary;
}

module.exports = { downloadPdfs, PDF_TYPES };
