'use strict';

/**
 * extractor.js — Core extraction logic.
 *
 * Extraction is a two-phase process:
 *
 *   Phase 1 — collectAllIds()
 *     Paginate the list API (?page=X&perPage=50) to discover ALL record IDs.
 *     This is essential because the ShopVox SPA only shows filtered/recent
 *     records in its UI — the list API returns everything.
 *
 *   Phase 2 — fetchRecords()
 *     Batch-fetch individual records in groups of batchSize using Promise.all
 *     inside page.evaluate(). For types with subPaths, also fetch
 *     /{id}/line_items, /{id}/line_items_quantities, /{id}/prices in the same
 *     batch and merge the results into the parent record.
 *
 * All API calls run inside the browser via page.evaluate(fetch(...)) with
 * credentials:'include'. Direct HTTP calls from Node would not carry the
 * session cookies.
 *
 * Progress is saved after each batch so extraction can be resumed.
 */

const fs   = require('fs');
const path = require('path');

const API_BASE = 'https://api.shopvox.com';
const PER_PAGE = 50;

/**
 * Data type definitions.
 * Each entry describes one ShopVox resource type.
 *
 * @type {Array<{
 *   name: string,
 *   listApi: string,
 *   arrayKey: string,
 *   subPaths: string[]
 * }>}
 */
const DATA_TYPES = [
  {
    name:     'quotes',
    listApi:  `${API_BASE}/edge/transactions/quotes`,
    arrayKey: 'quotes',
    subPaths: ['line_items', 'line_items_quantities', 'prices'],
  },
  {
    name:     'sales-orders',
    listApi:  `${API_BASE}/edge/transactions/work_orders`,
    arrayKey: 'workOrders',
    subPaths: ['line_items', 'line_items_quantities', 'prices'],
  },
  {
    name:     'invoices',
    listApi:  `${API_BASE}/edge/transactions/invoices`,
    arrayKey: 'invoices',
    subPaths: ['line_items', 'line_items_quantities', 'prices'],
  },
  {
    name:     'payments',
    listApi:  `${API_BASE}/edge/transactions/payments`,
    arrayKey: 'payments',
    subPaths: [],
  },
  {
    name:     'refunds',
    listApi:  `${API_BASE}/edge/transactions/refunds`,
    arrayKey: 'refunds',
    subPaths: ['line_items', 'line_items_quantities', 'prices'],
  },
  {
    name:     'contacts',
    listApi:  `${API_BASE}/edge/contacts`,
    arrayKey: 'contacts',
    subPaths: [],
  },
  {
    name:     'companies',
    listApi:  `${API_BASE}/edge/companies`,
    arrayKey: 'companies',
    subPaths: [],
  },
  {
    name:     'products',
    listApi:  `${API_BASE}/edge/products`,
    arrayKey: 'products',
    subPaths: [],
  },
  {
    name:     'vendors',
    listApi:  `${API_BASE}/edge/vendors`,
    arrayKey: 'vendors',
    subPaths: [],
  },
  {
    name:     'users',
    listApi:  `${API_BASE}/edge/users`,
    arrayKey: 'users',
    subPaths: [],
  },
  {
    name:     'tags',
    listApi:  `${API_BASE}/edge/tags`,
    arrayKey: 'tags',
    subPaths: [],
  },
  {
    name:     'tasks',
    listApi:  `${API_BASE}/edge/tasks`,
    arrayKey: 'tasks',
    subPaths: [],
  },
];

// ── Filesystem helpers ──────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Load previously saved records for a type.
 * Returns { records, ids } where ids is a Set of already-captured IDs.
 *
 * @param {string} outputDir
 * @param {string} typeName
 * @returns {{ records: object[], ids: Set<string> }}
 */
function loadExisting(outputDir, typeName) {
  const filePath = path.join(outputDir, `${typeName}.json`);
  if (!fs.existsSync(filePath)) return { records: [], ids: new Set() };

  try {
    const data    = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const records = Array.isArray(data.records) ? data.records : [];
    const ids     = new Set(
      records.map(r => r.id).filter(Boolean)
    );
    return { records, ids };
  } catch {
    return { records: [], ids: new Set() };
  }
}

/**
 * Persist records to disk (incremental save after each batch).
 *
 * @param {string} outputDir
 * @param {string} typeName
 * @param {object[]} records
 */
function saveRecords(outputDir, typeName, records) {
  ensureDir(outputDir);
  const filePath = path.join(outputDir, `${typeName}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    type:       typeName,
    total:      records.length,
    extractedAt: new Date().toISOString(),
    records,
  }, null, 2));
}

// ── Phase 1: ID collection ──────────────────────────────────────────────────

/**
 * Paginate the list API to collect all record IDs for a type.
 * Runs entirely inside the browser so session cookies are used automatically.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object} type  Entry from DATA_TYPES.
 * @param {Function} log
 * @returns {Promise<string[]>} All record IDs.
 */
async function collectAllIds(page, type, log) {
  log(`  Collecting IDs from list API: ${type.listApi}`);
  const ids = [];

  for (let pageNum = 1; pageNum <= 9_999; pageNum++) {
    const url = `${type.listApi}?page=${pageNum}&perPage=${PER_PAGE}`;

    const result = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { credentials: 'include' });
        if (!res.ok) return { __error: res.status, __url: u };
        return { __data: await res.json() };
      } catch (e) {
        return { __error: e.message };
      }
    }, url);

    if (result.__error) {
      log(`  Page ${pageNum}: API error ${result.__error} — stopping pagination`);
      break;
    }

    const data = result.__data;
    const arr  = data[type.arrayKey];

    if (!Array.isArray(arr) || arr.length === 0) {
      log(`  Page ${pageNum}: empty — done (${ids.length} total IDs)`);
      break;
    }

    for (const rec of arr) {
      if (rec.id) ids.push(String(rec.id));
    }

    log(`  Page ${pageNum}: ${arr.length} records (running total: ${ids.length})`);

    if (!data.meta?.hasNextPage) {
      log(`  No more pages — ${ids.length} total IDs`);
      break;
    }
  }

  return ids;
}

// ── Phase 2: Record fetching ────────────────────────────────────────────────

/**
 * Execute a batch of fetch() calls in parallel inside the browser.
 * Returns an array of { __url, __data } or { __url, __error } objects.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string[]} urls
 * @returns {Promise<object[]>}
 */
async function apiFetchBatch(page, urls) {
  return page.evaluate(async (urlList) => {
    const results = await Promise.all(
      urlList.map(async (url) => {
        try {
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) return { __url: url, __error: res.status };
          const data = await res.json();
          return { __url: url, __data: data };
        } catch (e) {
          return { __url: url, __error: e.message };
        }
      })
    );
    return results;
  }, urls);
}

/**
 * Fetch all pending records for a type, merging sub-endpoint data.
 * Saves incrementally after each batch for resume capability.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object} type           Entry from DATA_TYPES.
 * @param {string[]} allIds       All IDs discovered in Phase 1.
 * @param {Set<string>} existingIds IDs already captured in a previous run.
 * @param {object[]} existingRecords Records already captured.
 * @param {string} outputDir
 * @param {number} batchSize
 * @param {Function} log
 * @returns {Promise<object[]>} Final full record array.
 */
async function fetchRecords(
  page, type, allIds, existingIds, existingRecords, outputDir, batchSize, log
) {
  const pending = allIds.filter(id => !existingIds.has(id));
  log(`  ${existingIds.size} already captured, ${pending.length} to fetch`);

  if (pending.length === 0) return existingRecords;

  const allRecords = [...existingRecords];
  let fetched = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);

    // Build URL list: main record + each sub-path for every ID in batch
    const urls = batch.flatMap(id => [
      `${type.listApi}/${id}`,
      ...type.subPaths.map(sp => `${type.listApi}/${id}/${sp}`),
    ]);

    const results = await apiFetchBatch(page, urls);

    // Group responses by ID and sub-path
    const byId = {};
    for (const res of results) {
      if (!res.__url) continue;

      // Strip query string, then extract the UUID and optional sub-path
      const urlPath = res.__url.split('?')[0];
      // Match a UUID (36-char hex-dash) followed by optional /sub-path
      const match = urlPath.match(/([0-9a-f-]{8,}(?:-[0-9a-f-]+)*)(?:\/([^/]+))?$/i);
      if (!match) continue;

      const id      = match[1];
      const subPath = match[2] || '';

      if (!byId[id]) byId[id] = {};
      if (!res.__error && res.__data) {
        byId[id][subPath] = res.__data;
      }
    }

    // Merge and store each record
    for (const id of batch) {
      fetched++;
      const caps = byId[id] || {};

      if (Object.keys(caps).length === 0) {
        log(`  [${fetched}/${pending.length}] no data — skipping ${id}`);
        continue;
      }

      // Main record is stored under the empty-string key
      const main   = caps[''] || {};
      const merged = { ...main };

      // Merge sub-endpoint arrays into the record
      const liResp  = caps['line_items']            || {};
      const lqResp  = caps['line_items_quantities'] || {};
      const prResp  = caps['prices']                || {};

      if (liResp.lineItems)              merged.lineItems           = liResp.lineItems;
      if (lqResp.lineItemsQuantities)    merged.lineItemsQuantities = lqResp.lineItemsQuantities;
      if (prResp.prices)                 merged.priceTotals         = prResp.prices;

      allRecords.push({ id, data: merged });
      log(`  [${fetched}/${pending.length}] captured ${id}`);
    }

    // Incremental save after every batch
    saveRecords(outputDir, type.name, allRecords);
    log(`  Saved ${allRecords.length} ${type.name} records`);
  }

  return allRecords;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract all records for the given types.
 *
 * @param {import('puppeteer-core').Page} page  Authenticated Puppeteer page.
 * @param {object} config                        Validated config object.
 * @param {object} [opts]
 * @param {string[]} [opts.types]   Type names to extract. Defaults to all.
 * @param {Function} [opts.log]     Log function.
 * @returns {Promise<object>} Map of typeName -> record array.
 */
async function extractAll(page, config, opts = {}) {
  const {
    types: typeFilter = null,
    log = console.log,
  } = opts;

  ensureDir(config.outputDir);

  const typesToRun = typeFilter
    ? DATA_TYPES.filter(t => typeFilter.includes(t.name))
    : DATA_TYPES;

  if (typesToRun.length === 0) {
    throw new Error(
      `No matching types found. Valid types: ${DATA_TYPES.map(t => t.name).join(', ')}`
    );
  }

  const results = {};

  for (const type of typesToRun) {
    log(`\n${'='.repeat(50)}`);
    log(`Extracting: ${type.name}`);
    log('='.repeat(50));

    // Load previously captured records (resume support)
    const { records: existingRecords, ids: existingIds } = loadExisting(
      config.outputDir, type.name
    );
    log(`  ${existingIds.size} previously captured records found`);

    // Phase 1: Discover all IDs
    const allIds = await collectAllIds(page, type, log);
    log(`  ${allIds.length} total IDs discovered in API`);

    if (allIds.length === 0) {
      log(`  No records found — skipping ${type.name}`);
      results[type.name] = existingRecords;
      continue;
    }

    // Phase 2: Fetch missing records
    const finalRecords = await fetchRecords(
      page, type, allIds, existingIds, existingRecords,
      config.outputDir, config.batchSize, log
    );

    results[type.name] = finalRecords;
    log(`  Done: ${finalRecords.length} total ${type.name} records`);
  }

  return results;
}

module.exports = { extractAll, DATA_TYPES, loadExisting, saveRecords };
