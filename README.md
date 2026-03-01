# shopvox-extractor

Export all data from your ShopVox account to JSON (and optionally CSV) — without a paid API license.

ShopVox's REST API requires a paid developer license for direct HTTP access. This tool works differently: it launches your existing Chrome session, reuses your authenticated cookies, and calls the same API the ShopVox web app uses — so no extra license is needed.

---

## Two Extraction Modes

| Mode | Command | Output | Best for |
|------|---------|--------|----------|
| **JSON data** | `shopvox-extractor extract` | Structured JSON files | Database import, migration, analysis |
| **PDF files** | `shopvox-extractor download-pdfs` | PDF files per transaction | Document archival, record keeping |

Both modes discover **all** records via the API — not just what's visible in the ShopVox UI.

---

## Prerequisites

- **macOS, Windows, or Linux** (cookie decryption is supported on all three platforms)
- **Node.js 18+**
- **Google Chrome** (must be installed and you must have logged in to ShopVox at least once)
- **Python 3** with platform-appropriate packages:

  **macOS / Linux:**
  ```bash
  pip3 install cryptography
  ```

  **Windows:**
  ```bash
  pip install cryptography pywin32
  ```

---

## Installation

```bash
npm install -g shopvox-extractor
```

Or run directly without installing globally:

```bash
npx shopvox-extractor extract
```

---

## Configuration

### 1. Create a config file

```bash
shopvox-extractor init
```

This creates `shopvox.config.json` in the current directory:

```json
{
  "email":      "you@example.com",
  "password":   "yourpassword",
  "outputDir":  "./shopvox-data",
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "batchSize":  30
}
```

### 2. Edit the config

| Field        | Required | Default                                             | Description                                 |
|--------------|----------|-----------------------------------------------------|---------------------------------------------|
| `email`      | Yes      | —                                                   | Your ShopVox login email                    |
| `password`   | Yes      | —                                                   | Your ShopVox login password                 |
| `outputDir`  | No       | `./shopvox-data`                                    | Directory for JSON/CSV output               |
| `chromePath` | No       | `/Applications/Google Chrome.app/...`               | Path to Chrome executable                   |
| `batchSize`  | No       | `30`                                                | Parallel API requests per batch             |

> **Security note**: `shopvox.config.json` contains your password in plain text. Add it to `.gitignore` and keep it out of version control.

---

## Usage

### Extract everything

```bash
shopvox-extractor extract
```

### Extract specific data types

```bash
shopvox-extractor extract --types quotes,invoices,contacts
```

### Also export CSV files

```bash
shopvox-extractor extract --csv
```

### Custom output directory

```bash
shopvox-extractor extract --output ./my-exports
```

### Show Chrome window (useful if MFA triggers)

```bash
shopvox-extractor extract --headed
```

### Use a specific config file

```bash
shopvox-extractor extract --config /path/to/shopvox.config.json
```

### Download PDFs for all transaction types

```bash
shopvox-extractor download-pdfs
```

### Download PDFs for specific types

```bash
shopvox-extractor download-pdfs --types quotes,invoices
```

### List all supported data types

```bash
shopvox-extractor types
```

---

## Supported Data Types

| Type          | API Endpoint                          | Sub-data fetched                          |
|---------------|---------------------------------------|-------------------------------------------|
| `quotes`      | `/edge/transactions/quotes`           | line_items, line_items_quantities, prices |
| `sales-orders`| `/edge/transactions/work_orders`      | line_items, line_items_quantities, prices |
| `invoices`    | `/edge/transactions/invoices`         | line_items, line_items_quantities, prices |
| `payments`    | `/edge/transactions/payments`         | —                                         |
| `refunds`     | `/edge/transactions/refunds`          | line_items, line_items_quantities, prices |
| `contacts`    | `/edge/contacts`                      | —                                         |
| `companies`   | `/edge/companies`                     | —                                         |
| `products`    | `/edge/products`                      | —                                         |
| `vendors`     | `/edge/vendors`                       | —                                         |
| `users`       | `/edge/users`                         | —                                         |
| `tags`        | `/edge/tags`                          | —                                         |
| `tasks`       | `/edge/tasks`                         | —                                         |

---

## Output Format

### JSON (always written)

Each data type gets its own file: `<outputDir>/<type>.json`

```json
{
  "type": "invoices",
  "total": 1247,
  "extractedAt": "2024-01-15T10:30:00.000Z",
  "records": [
    {
      "id": "abc-123",
      "data": {
        "id": "abc-123",
        "invoiceNumber": "INV-0042",
        "contact": { "name": "Acme Corp" },
        "lineItems": [ ... ],
        "priceTotals": { ... }
      }
    }
  ]
}
```

### CSV (with `--csv` flag)

Each data type also gets a CSV file: `<outputDir>/<type>.csv`

- **Transaction types** (quotes, sales-orders, invoices, refunds): one row per line item, with parent transaction fields repeated on each row — ideal for pivot tables.
- **Other types**: one row per record.
- Nested objects are flattened with dot notation: `contact.name`, `address.city`.
- Arrays of scalars are joined with ` | `.

---

## How It Works

1. **Cookie extraction**: The tool reads Chrome's SQLite cookie database, decrypts the encrypted values, and outputs them as JSON for Puppeteer. Decryption is platform-specific:
   - **macOS**: AES-128-CBC using a key from macOS Keychain ("Chrome Safe Storage"), PBKDF2-SHA1 with 1003 iterations.
   - **Linux**: AES-128-CBC using the hardcoded password `peanuts`, PBKDF2-SHA1 with 1 iteration.
   - **Windows**: AES-256-GCM using a master key stored in `Local State` and protected by Windows DPAPI.

2. **Browser launch**: Puppeteer launches Chrome with your decrypted cookies pre-injected. This gives the browser a valid ShopVox session without requiring a new login (MFA is bypassed because the `ctdt` device-trust cookie is reused).

3. **ID collection (Phase 1)**: For each data type, the tool paginates the list API (`?page=X&perPage=50`) inside the browser context (`page.evaluate(fetch(...))`). This discovers ALL record IDs — including records that would be filtered out or hidden in the ShopVox UI.

4. **Record fetching (Phase 2)**: Individual records are fetched in parallel batches of 30. For transaction types, the sub-endpoints (`/line_items`, `/line_items_quantities`, `/prices`) are fetched in the same batch and merged into the parent record.

5. **Incremental save**: After each batch, results are written to disk. If extraction is interrupted, re-running will skip already-captured records and resume from where it left off.

---

## Resume / Incremental Extraction

If extraction is interrupted (network error, Chrome crash, Ctrl+C), simply re-run the same command. The tool detects existing output files, skips already-captured IDs, and fetches only the missing records.

---

## Troubleshooting

### "Could not retrieve Chrome Safe Storage key"
Make sure Chrome is installed and you have logged into it at least once. The macOS Keychain entry is created when Chrome first stores a cookie.

### "cryptography package is required"
Run: `pip3 install cryptography`

### MFA / login required
Run with `--headed` to see the Chrome window:
```bash
shopvox-extractor extract --headed
```
Complete MFA manually, then the extraction will continue automatically. For future runs, the `ctdt` device-trust cookie will be present and MFA will be bypassed.

### Extraction is slow
Increase `batchSize` in your config (default: 30). Be careful not to set it too high — ShopVox may rate-limit concurrent requests.

### "networkidle2 timeout"
ShopVox's SPA can be slow to settle. The tool handles this gracefully. If it persists, try `--headed` to see what Chrome is doing.

---

## Limitations

- **macOS, Windows, and Linux** are supported for cookie decryption. macOS uses the Keychain (AES-128-CBC), Linux uses a hardcoded password (AES-128-CBC), and Windows uses DPAPI-protected master key (AES-256-GCM).
- **Google Chrome only** (not Chromium, Firefox, or Safari). The cookie DB path and encryption format are Chrome-specific.
- **Session must exist**: You must have logged into ShopVox in Chrome at least once. If your session has expired and MFA is required, use `--headed`.
- **Rate limiting**: ShopVox may throttle aggressive extraction. The default `batchSize: 30` is conservative.

---

## Programmatic API

```js
const { extract }    = require('shopvox-extractor');
const { loadConfig } = require('shopvox-extractor/src/config');

const config = loadConfig(); // reads shopvox.config.json

const results = await extract(config, {
  types:    ['invoices', 'contacts'],
  csv:      true,
  headless: true,
  log:      console.log,
});

// results['invoices'] → array of record objects
console.log(`Extracted ${results.invoices.length} invoices`);
```

---

## License

MIT
