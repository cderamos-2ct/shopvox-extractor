'use strict';

/**
 * config.js — load and validate shopvox.config.json
 *
 * Searches for the config file in the current working directory,
 * then walks up parent directories until it finds one or reaches the
 * filesystem root.
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'shopvox.config.json';

const DEFAULTS = {
  outputDir:  './shopvox-data',
  chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  batchSize:  30,
};

const REQUIRED_FIELDS = ['email', 'password'];

/**
 * Find shopvox.config.json by walking up from startDir.
 * Returns the absolute path to the file, or null if not found.
 *
 * @param {string} startDir
 * @returns {string|null}
 */
function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

/**
 * Load, parse, and validate the config file.
 * Merges defaults for optional fields.
 *
 * @param {string} [startDir=process.cwd()] Directory to start searching from.
 * @param {string} [explicitPath]            Explicit path to config file (overrides search).
 * @returns {object} Validated config object.
 * @throws {Error} If config is missing or invalid.
 */
function loadConfig(startDir = process.cwd(), explicitPath = null) {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : findConfigFile(startDir);

  if (!configPath) {
    throw new Error(
      `Could not find ${CONFIG_FILENAME}.\n` +
      `Run "shopvox-extractor init" to create one, or copy shopvox.config.example.json.`
    );
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${err.message}`);
  }

  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!raw[field] || typeof raw[field] !== 'string' || !raw[field].trim()) {
      throw new Error(
        `Config is missing required field "${field}" in ${configPath}`
      );
    }
  }

  // Merge with defaults
  const config = { ...DEFAULTS, ...raw };

  // Resolve outputDir relative to config file location
  if (!path.isAbsolute(config.outputDir)) {
    config.outputDir = path.resolve(path.dirname(configPath), config.outputDir);
  }

  // Validate batchSize
  config.batchSize = parseInt(config.batchSize, 10);
  if (isNaN(config.batchSize) || config.batchSize < 1) {
    config.batchSize = DEFAULTS.batchSize;
  }

  config._configPath = configPath;
  return config;
}

/**
 * Write a starter config file at the given path.
 *
 * @param {string} destPath Absolute path where config should be written.
 */
function writeExampleConfig(destPath) {
  const example = {
    email:      'you@example.com',
    password:   'yourpassword',
    outputDir:  './shopvox-data',
    chromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    batchSize:  30,
  };
  fs.writeFileSync(destPath, JSON.stringify(example, null, 2) + '\n');
}

module.exports = { loadConfig, findConfigFile, writeExampleConfig, CONFIG_FILENAME };
