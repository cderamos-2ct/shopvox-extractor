#!/usr/bin/env node
'use strict';

/**
 * cli.js — Command-line interface for shopvox-extractor.
 *
 * Commands:
 *   shopvox-extractor init              Create a starter shopvox.config.json
 *   shopvox-extractor extract           Extract all data types
 *   shopvox-extractor extract --types   Comma-separated list of types
 *   shopvox-extractor extract --csv     Also write CSV files
 *   shopvox-extractor extract --output  Override outputDir
 *   shopvox-extractor extract --headed  Show Chrome window (useful for MFA)
 *   shopvox-extractor types             List all supported data types
 */

const path = require('path');
const fs   = require('fs');

// Resolve sibling src/ regardless of how the CLI is invoked
const { loadConfig, writeExampleConfig, CONFIG_FILENAME } = require('../src/config');
const { extract }                                          = require('../src/index');
const { DATA_TYPES }                                       = require('../src/extractor');

// ── Argument parsing ────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const command = args[0] || 'help';

/** Parse --flag or --flag=value from args array. */
function getFlag(name, defaultVal = null) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) return args[i + 1] ?? true;
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return defaultVal;
}

function hasFlag(name) {
  return args.some(a => a === `--${name}` || a.startsWith(`--${name}=`));
}

// ── Logger ──────────────────────────────────────────────────────────────────

function log(msg) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${time}] ${msg}`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
shopvox-extractor — Export all data from your ShopVox account

USAGE
  shopvox-extractor <command> [options]

COMMANDS
  init                  Create a starter shopvox.config.json in the current directory
  extract               Extract data from ShopVox
  types                 List all supported data types
  help                  Show this help message

EXTRACT OPTIONS
  --types <list>        Comma-separated type names (default: all)
                        e.g. --types quotes,invoices,contacts
  --output <dir>        Override outputDir from config
  --csv                 Write CSV files in addition to JSON
  --headed              Show the Chrome window (useful if MFA is triggered)
  --config <path>       Path to config file (default: search from cwd upward)

EXAMPLES
  shopvox-extractor init
  shopvox-extractor extract
  shopvox-extractor extract --types quotes,invoices
  shopvox-extractor extract --csv --output ./exports
  shopvox-extractor extract --headed

SUPPORTED TYPES
  ${DATA_TYPES.map(t => t.name).join(', ')}

CONFIGURATION
  Create shopvox.config.json (or run "init"):
  {
    "email":      "you@example.com",
    "password":   "yourpassword",
    "outputDir":  "./shopvox-data",
    "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "batchSize":  30
  }
`);
}

function cmdTypes() {
  console.log('\nSupported data types:\n');
  for (const t of DATA_TYPES) {
    const subs = t.subPaths.length > 0 ? ` (+ ${t.subPaths.join(', ')})` : '';
    console.log(`  ${t.name.padEnd(16)} ${t.listApi}${subs}`);
  }
  console.log('');
}

function cmdInit() {
  const destPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(destPath)) {
    console.error(`Config already exists: ${destPath}`);
    console.error('Delete it first if you want to regenerate it.');
    process.exit(1);
  }
  writeExampleConfig(destPath);
  console.log(`Created ${destPath}`);
  console.log('Edit it with your ShopVox credentials and then run:');
  console.log('  shopvox-extractor extract');
}

async function cmdExtract() {
  // Load config
  const configFlag = getFlag('config');
  let config;
  try {
    config = loadConfig(process.cwd(), configFlag || null);
  } catch (err) {
    console.error(`\nConfiguration error: ${err.message}\n`);
    process.exit(1);
  }

  // Apply CLI overrides
  const outputOverride = getFlag('output');
  if (outputOverride) {
    config.outputDir = path.resolve(process.cwd(), outputOverride);
  }

  const typesFlag = getFlag('types');
  const types = typesFlag
    ? String(typesFlag).split(',').map(s => s.trim()).filter(Boolean)
    : null;

  const csv     = hasFlag('csv');
  const headed  = hasFlag('headed');

  log(`Config: ${config._configPath}`);
  log(`Output: ${config.outputDir}`);
  log(`Types:  ${types ? types.join(', ') : 'all'}`);
  log(`CSV:    ${csv}`);
  log(`Mode:   ${headed ? 'headed (Chrome visible)' : 'headless'}`);

  // Validate requested types
  if (types) {
    const validNames = new Set(DATA_TYPES.map(t => t.name));
    const invalid = types.filter(t => !validNames.has(t));
    if (invalid.length > 0) {
      console.error(`\nUnknown type(s): ${invalid.join(', ')}`);
      console.error(`Valid types: ${[...validNames].join(', ')}`);
      process.exit(1);
    }
  }

  try {
    const results = await extract(config, {
      types,
      csv,
      headless: !headed,
      log,
    });

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('Extraction complete');
    console.log('='.repeat(50));
    for (const [typeName, records] of Object.entries(results)) {
      console.log(`  ${typeName.padEnd(18)} ${records.length} records`);
    }
    console.log(`\nOutput directory: ${config.outputDir}`);
    console.log('');

  } catch (err) {
    console.error(`\nExtraction failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

switch (command) {
  case 'init':
    cmdInit();
    break;

  case 'extract':
    cmdExtract().catch(err => {
      console.error(err.message);
      process.exit(1);
    });
    break;

  case 'types':
    cmdTypes();
    break;

  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "shopvox-extractor help" for usage.');
    process.exit(1);
}
