'use strict';

/**
 * csv.js — Convert extracted JSON records to CSV format.
 *
 * Flattening strategy:
 *   - Simple scalar fields: output as-is.
 *   - Nested objects: flatten with dot notation (e.g., contact.name).
 *   - Arrays of scalars: join with " | ".
 *   - Arrays of objects (e.g., lineItems): one row per element, repeating
 *     all parent scalar fields on each row.
 *
 * For transaction types (quotes, sales-orders, invoices, refunds), the
 * primary expansion key is lineItems. Each line item becomes its own row,
 * with the parent transaction fields repeated for easy pivot-table use.
 */

const fs   = require('fs');
const path = require('path');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape a value for CSV (RFC 4180).
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 *
 * @param {*} val
 * @returns {string}
 */
function csvEscape(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Flatten a nested object into a flat key→value map using dot notation.
 * Arrays of objects are NOT flattened here — they are handled separately.
 * Arrays of scalars are joined with " | ".
 *
 * @param {object} obj
 * @param {string} [prefix='']
 * @returns {object} Flat key→value map.
 */
function flattenObject(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[fullKey] = '';
    } else if (Array.isArray(value)) {
      // Arrays of plain objects are handled by the row-expansion logic;
      // here we just mark them as skipped so callers know to handle them.
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
        // Signal to caller — do not flatten inline
        result[`__array__${fullKey}`] = value;
      } else {
        // Array of scalars → join
        result[fullKey] = value.join(' | ');
      }
    } else if (typeof value === 'object') {
      // Recursively flatten nested objects
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Convert a list of flat-row objects into CSV text.
 *
 * @param {object[]} rows Array of flat key→value maps (all sharing the same keys).
 * @returns {string} CSV content with header row.
 */
function rowsToCsv(rows) {
  if (rows.length === 0) return '';

  // Collect all unique keys preserving insertion order
  const allKeys = [];
  const keySet  = new Set();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!k.startsWith('__array__') && !keySet.has(k)) {
        allKeys.push(k);
        keySet.add(k);
      }
    }
  }

  const lines = [allKeys.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(allKeys.map(k => csvEscape(row[k] ?? '')).join(','));
  }

  return lines.join('\n') + '\n';
}

// ── Per-type conversion ──────────────────────────────────────────────────────

/**
 * The primary expansion key for each type.
 * When present, one CSV row is created per element of this array,
 * with parent fields repeated on every row.
 */
const EXPANSION_KEYS = {
  'quotes':       'lineItems',
  'sales-orders': 'lineItems',
  'invoices':     'lineItems',
  'refunds':      'lineItems',
};

/**
 * Convert an array of extracted records to CSV rows.
 *
 * @param {object[]} records   Records from the JSON output file (each: { id, data }).
 * @param {string}   typeName  Data type name (e.g. 'invoices').
 * @returns {object[]} Array of flat row objects.
 */
function recordsToRows(records, typeName) {
  const expansionKey = EXPANSION_KEYS[typeName] || null;
  const rows = [];

  for (const record of records) {
    const data = record.data || record;
    const flat = flattenObject(data);

    // Separate scalar fields from embedded arrays
    const scalarFields = {};
    const arrayFields  = {};
    for (const [k, v] of Object.entries(flat)) {
      if (k.startsWith('__array__')) {
        arrayFields[k.slice('__array__'.length)] = v;
      } else {
        scalarFields[k] = v;
      }
    }

    const expandArray = expansionKey ? arrayFields[expansionKey] : null;

    if (expandArray && expandArray.length > 0) {
      // One row per line item, repeating parent fields
      for (const item of expandArray) {
        const itemFlat = flattenObject(item, expansionKey);
        const itemScalars = {};
        for (const [k, v] of Object.entries(itemFlat)) {
          if (!k.startsWith('__array__')) itemScalars[k] = v;
        }
        rows.push({ ...scalarFields, ...itemScalars });
      }
    } else {
      // No expansion array — one row per record
      // Render any remaining arrays as joined strings
      for (const [arrKey, arrVal] of Object.entries(arrayFields)) {
        try {
          scalarFields[arrKey] = JSON.stringify(arrVal);
        } catch {
          scalarFields[arrKey] = '[array]';
        }
      }
      rows.push(scalarFields);
    }
  }

  return rows;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a CSV file for the given type.
 *
 * @param {object[]} records   Array of { id, data } record objects.
 * @param {string}   typeName  Data type name.
 * @param {string}   outputDir Directory to write the CSV into.
 * @returns {string} Path to the written CSV file.
 */
function writeCsv(records, typeName, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const rows    = recordsToRows(records, typeName);
  const csv     = rowsToCsv(rows);
  const outPath = path.join(outputDir, `${typeName}.csv`);

  fs.writeFileSync(outPath, csv, 'utf8');
  return outPath;
}

module.exports = { writeCsv, recordsToRows, rowsToCsv };
