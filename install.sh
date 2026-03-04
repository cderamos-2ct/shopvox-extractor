#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# shopvox-extractor — macOS / Linux installer
#
# Usage (one-liner, no download needed):
#   curl -fsSL https://raw.githubusercontent.com/cderamos-2ct/shopvox-extractor/main/install.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC}  $1"; exit 1; }
info() { echo -e "${BOLD}▶${NC} $1"; }

echo ""
echo -e "${BOLD}shopvox-extractor installer${NC}"
echo "────────────────────────────────────"

# ── 1. Node.js ───────────────────────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
    fail "Node.js is not installed. Download it from https://nodejs.org and re-run this script."
fi
NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo ok || echo old)
if [ "$NODE_VER" = "old" ]; then
    fail "Node.js $(node --version) is too old. Version 18 or newer is required. Download from https://nodejs.org"
fi
ok "Node.js $(node --version)"

# ── 2. Python 3 ──────────────────────────────────────────────────────────────
info "Checking Python 3..."
if ! command -v python3 &>/dev/null; then
    fail "Python 3 is not installed. Download it from https://python.org and re-run this script."
fi
ok "Python $(python3 --version)"

# ── 3. cryptography package ───────────────────────────────────────────────────
info "Installing Python cryptography package..."
if python3 -c "import cryptography" &>/dev/null; then
    ok "cryptography already installed"
else
    pip3 install --quiet cryptography && ok "cryptography installed" || \
        fail "Could not install cryptography. Try: pip3 install cryptography"
fi

# ── 4. Google Chrome ─────────────────────────────────────────────────────────
info "Checking Google Chrome..."
CHROME_MAC="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_LINUX=$(command -v google-chrome 2>/dev/null || command -v google-chrome-stable 2>/dev/null || echo "")
if [ -f "$CHROME_MAC" ]; then
    ok "Chrome found (macOS)"
elif [ -n "$CHROME_LINUX" ]; then
    ok "Chrome found (Linux: $CHROME_LINUX)"
else
    warn "Chrome not found. Install Google Chrome from https://google.com/chrome before running the extractor."
fi

# ── 5. Install shopvox-extractor ─────────────────────────────────────────────
info "Installing shopvox-extractor from GitHub..."
npm install -g github:cderamos-2ct/shopvox-extractor --silent && ok "shopvox-extractor installed" || \
    fail "npm install failed. Make sure npm is available (it comes with Node.js)."

# ── 6. Create working folder and config ──────────────────────────────────────
WORK_DIR="$HOME/shopvox-export"
info "Setting up working folder at $WORK_DIR..."
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

if [ -f "shopvox.config.json" ]; then
    warn "shopvox.config.json already exists — skipping init (your existing config is unchanged)"
else
    shopvox-extractor init
    ok "Config file created at $WORK_DIR/shopvox.config.json"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo "────────────────────────────────────"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit your config file:"
echo -e "     ${BOLD}open $WORK_DIR/shopvox.config.json${NC}  (or use any text editor)"
echo "     Fill in your ShopVox email and password."
echo ""
echo "  2. Log into ShopVox in Google Chrome (if you haven't already)."
echo ""
echo "  3. Run the extractor:"
echo -e "     ${BOLD}cd $WORK_DIR && shopvox-extractor extract${NC}"
echo ""
echo "  Full instructions: https://github.com/cderamos-2ct/shopvox-extractor/blob/main/INSTRUCTIONS.md"
echo ""
