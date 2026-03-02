# Step-by-Step Instructions: shopvox-extractor

This guide walks you through exporting **all your ShopVox data** — quotes, invoices, sales orders, contacts, products, and more — as JSON files you can open in Excel, import into a database, or use to migrate to another platform.

> No paid ShopVox API license needed. This tool works by reusing your existing browser session.

---

## What You'll Export

| Data | Records exported |
|------|-----------------|
| Quotes | All, with full line items |
| Sales Orders | All, with full line items |
| Invoices | All, with full line items |
| Payments | All |
| Contacts | All individual contacts |
| Companies / Customers | All |
| Products / Catalog | All |
| Vendors | All |
| Users / Staff | All |
| Tags, Tasks, Refunds | All |

---

## Before You Start

You need three things installed on your Mac:

### 1. Node.js (version 18 or newer)
Check if you have it:
```bash
node --version
```
If you see `v18.x.x` or higher, you're good. If not, download it from:
**https://nodejs.org** — click the "LTS" button and install it.

### 2. Python 3
Check if you have it:
```bash
python3 --version
```
Most Macs already have Python 3. If not, download from **https://python.org**.

Then install the required Python package:
```bash
pip3 install cryptography
```

### 3. Google Chrome
The tool reads your Chrome cookies to log into ShopVox automatically.
- Make sure **Google Chrome** is installed (not Safari, Firefox, or Chromium)
- Make sure you have **logged into ShopVox in Chrome** at least once

---

## Windows Instructions

### Windows Prerequisites

- **Node.js 18+** from https://nodejs.org
- **Python 3** + required packages:
  ```bash
  pip install cryptography pywin32
  ```
- **Google Chrome** (must be logged into ShopVox)

### Windows Steps

1. Open **Command Prompt** or **PowerShell** and install the tool:
   ```
   npm install -g github:cderamos-2ct/shopvox-extractor
   ```
   No git, no account, no sign-up needed.

2. Create a working folder and config file:
   ```
   mkdir %USERPROFILE%\shopvox-export
   cd %USERPROFILE%\shopvox-export
   shopvox-extractor init
   ```
   Edit `shopvox.config.json` — set `chromePath` to:
   ```json
   "chromePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
   ```
   Also fill in your ShopVox `email` and `password`.

3. Log into ShopVox in Chrome, then run:
   ```
   shopvox-extractor extract
   ```

---

## Method 2: Download PDFs

In addition to exporting JSON data, you can download the actual PDF files for your quotes, invoices, sales orders, and other transaction types.

**PDFs are saved to:** `shopvox-data/pdfs/<type>/` folders

```
shopvox-data/
└── pdfs/
    ├── quotes/
    ├── invoices/
    ├── sales-orders/
    ├── payments/
    ├── purchase-orders/
    ├── credit-memos/
    └── refunds/
```

> **Note:** Chrome will open visibly while PDF download runs. This is required — Chrome's PDF download behavior works differently in headless mode, so the browser must be visible.

### Download all PDFs

```bash
shopvox-extractor download-pdfs
```

### Download specific types only

```bash
shopvox-extractor download-pdfs --types quotes,invoices
```

### Resumable

The tool tracks downloaded IDs in a `.downloaded` file inside each type folder. If interrupted, re-running the command will skip already-downloaded records and pick up where it left off.

### JSON and PDF are complementary

| Method | Command | Output | Best for |
|--------|---------|--------|----------|
| **JSON data** | `shopvox-extractor extract` | Structured JSON files | Database import, migration, analysis |
| **PDF files** | `shopvox-extractor download-pdfs` | PDF files per transaction | Document archival, record keeping |

You can run both — they work independently and save to different folders.

---

## Step 1 — Install the Tool

Open **Terminal** (press `Cmd + Space`, type `Terminal`, press Enter) and run:

```bash
npm install -g github:cderamos-2ct/shopvox-extractor
```

That's it — no account needed, no sign-up, no git clone. npm installs it directly from GitHub. When it finishes, the `shopvox-extractor` command is available system-wide.

---

## Step 2 — Create Your Config File

Create a working folder (anywhere you like), then open a Terminal there and run:

```bash
mkdir ~/shopvox-export && cd ~/shopvox-export
shopvox-extractor init
```

This creates the file with placeholder values. Now edit it with your credentials:

```bash
open shopvox.config.json
```

Replace the placeholders with your actual ShopVox login:

```json
{
  "email":      "your@email.com",
  "password":   "yourpassword",
  "outputDir":  "./shopvox-data",
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "batchSize":  30
}
```

Save and close the file.

> ⚠️ **Keep this file private.** It contains your password. Never share it or upload it anywhere.

---

## Step 3 — Log Into ShopVox in Chrome

Open **Google Chrome** and go to **https://express.shopvox.com**.
Log in normally (including MFA if required).

You only need to do this once. The tool will reuse your session automatically from then on — even if MFA is enabled.

---

## Step 4 — Run the Extraction

Back in Terminal, make sure you're in the `shopvox-extractor` folder:

```bash
cd ~/shopvox-export
```

Then run:

```bash
shopvox-extractor extract
```

You'll see Chrome open briefly in the background. The tool will:
1. Load your Chrome cookies and authenticate silently
2. Discover all records in your account via the ShopVox API
3. Download them in batches and save to `shopvox-data/`

**Expected output:**
```
[10:32:01] Navigating to ShopVox SPA to verify session...
[10:32:04] Session cookie valid — already authenticated.

==================================================
Extracting: quotes
==================================================
  0 previously captured records found
  Collecting IDs from list API...
  Page 1: 50 records (running total: 50)
  Page 2: 50 records (running total: 100)
  ...
  243 total IDs discovered in API
  0 already captured, 243 to fetch
  [30/243] captured abc-123
  ...
```

Depending on how many records you have, this takes **5–20 minutes**.

---

## Step 5 — Find Your Exported Files

When finished, all data is in the `shopvox-data/` folder:

```
shopvox-data/
├── quotes.json
├── sales-orders.json
├── invoices.json
├── payments.json
├── contacts.json
├── customers.json
├── products.json
├── vendors.json
├── users.json
├── tags.json
├── tasks.json
└── refunds.json
```

Each file is a standard JSON file you can:
- Open in any code editor (VS Code, etc.)
- Import into MongoDB, PostgreSQL, MySQL, Airtable, etc.
- Convert to Excel/CSV using online tools or Python

---

## Tips & Troubleshooting

### Extract only specific data types
```bash
shopvox-extractor extract --types quotes,invoices,contacts
```

### If extraction is interrupted, just re-run it
The tool automatically skips records it already captured and picks up where it left off:
```bash
shopvox-extractor extract
```

### If Chrome asks for MFA
Run with `--headed` to see the browser window and complete MFA manually:
```bash
shopvox-extractor extract --headed
```
After you complete MFA once, future runs won't need it (the trust cookie is saved).

### See all available commands
```bash
shopvox-extractor help
shopvox-extractor types   # lists all types for both extract and download-pdfs
```

### The Mac goes to sleep during a long extraction
Run with `caffeinate` to prevent sleep:
```bash
caffeinate -dims shopvox-extractor extract
```

---

## Frequently Asked Questions

**Q: Does this work on Windows or Linux?**
A: Yes! All three platforms are supported. macOS uses the Keychain, Linux uses a hardcoded Chrome password, and Windows uses the DPAPI-protected master key. See the Windows Instructions section above for Windows-specific setup steps.

**Q: Is this safe? Will it break my ShopVox account?**
A: Yes, it's safe. The tool only reads data — it never modifies, deletes, or writes anything to your account. It makes the same API calls your browser makes when you view records normally.

**Q: Why not just use the ShopVox API directly?**
A: ShopVox's official API requires a paid developer license. This tool bypasses that by using your existing browser session, which is free.

**Q: What if my session expires mid-extraction?**
A: The tool detects this and automatically logs back in using your credentials. If MFA blocks it, run with `--headed` and complete MFA manually.

**Q: How do I open JSON files in Excel?**
A: Use a free online converter like https://www.convertcsv.com/json-to-csv.htm, or ask for the `--csv` flag to be added (it's already built into the tool).

---

## Source Code

Everything is open source on GitHub:
**https://github.com/cderamos-2ct/shopvox-extractor**

Found a bug or want to contribute? Open an issue or pull request!
