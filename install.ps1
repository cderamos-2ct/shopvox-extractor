# ─────────────────────────────────────────────────────────────────────────────
# shopvox-extractor — Windows PowerShell installer
#
# Usage (one-liner, run in PowerShell as Administrator):
#   irm https://raw.githubusercontent.com/cderamos-2ct/shopvox-extractor/main/install.ps1 | iex
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [X]  $msg" -ForegroundColor Red; exit 1 }
function Info($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }

Write-Host ""
Write-Host "shopvox-extractor installer (Windows)" -ForegroundColor White
Write-Host "--------------------------------------"

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Info "Checking Node.js..."
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "Node.js is not installed.`n     Download from https://nodejs.org (LTS version) and re-run this script."
}
$nodeVer = (node -e "process.stdout.write(process.version)").TrimStart('v')
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 18) {
    Fail "Node.js v$nodeVer is too old. Version 18+ required.`n     Download from https://nodejs.org"
}
Ok "Node.js v$nodeVer"

# ── 2. Git ────────────────────────────────────────────────────────────────────
Info "Checking Git..."
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "Git is not installed. npm needs Git to install from GitHub.`n     Download from https://git-scm.com/download/win, install it, then restart PowerShell and re-run this script."
}
Ok "Git $(git --version)"

# ── 3. Python ─────────────────────────────────────────────────────────────────
Info "Checking Python..."
$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $ver = & $cmd --version 2>&1
        if ($ver -match "Python 3") { $pythonCmd = $cmd; break }
    }
}
if (-not $pythonCmd) {
    Fail "Python 3 is not installed.`n     Download from https://python.org and re-run this script."
}
Ok "$(& $pythonCmd --version)"

# ── 4. Python packages ────────────────────────────────────────────────────────
Info "Installing Python packages (cryptography, pywin32)..."
try {
    & $pythonCmd -c "import cryptography, win32crypt" 2>$null
    Ok "Python packages already installed"
} catch {
    & $pythonCmd -m pip install --quiet cryptography pywin32
    Ok "cryptography and pywin32 installed"
}

# ── 5. Google Chrome ──────────────────────────────────────────────────────────
Info "Checking Google Chrome..."
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chromeFound = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chromeFound) {
    Ok "Chrome found at $chromeFound"
} else {
    Warn "Chrome not found. Install Google Chrome from https://google.com/chrome before running the extractor."
}

# ── 6. Install shopvox-extractor ──────────────────────────────────────────────
Info "Installing shopvox-extractor from GitHub..."
npm install -g github:cderamos-2ct/shopvox-extractor --silent
if ($LASTEXITCODE -ne 0) { Fail "npm install failed. Check the output above." }
Ok "shopvox-extractor installed"

# ── 7. Create working folder and config ───────────────────────────────────────
$workDir = "$env:USERPROFILE\shopvox-export"
Info "Setting up working folder at $workDir..."
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
Set-Location $workDir

if (Test-Path "shopvox.config.json") {
    Warn "shopvox.config.json already exists — skipping init (your existing config is unchanged)"
} else {
    shopvox-extractor init
    Ok "Config file created at $workDir\shopvox.config.json"

    # Set the correct Chrome path automatically if found
    if ($chromeFound) {
        $config = Get-Content "shopvox.config.json" | ConvertFrom-Json
        $config.chromePath = $chromeFound
        $config | ConvertTo-Json -Depth 10 | Set-Content "shopvox.config.json"
        Ok "Chrome path set automatically in config"
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host "--------------------------------------"
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
Write-Host "  1. Edit your config file:"
Write-Host "     notepad $workDir\shopvox.config.json" -ForegroundColor White
Write-Host "     Fill in your ShopVox email and password."
Write-Host ""
Write-Host "  2. Log into ShopVox in Google Chrome (if you haven't already)."
Write-Host ""
Write-Host "  3. Run the extractor:"
Write-Host "     cd $workDir" -ForegroundColor White
Write-Host "     shopvox-extractor extract" -ForegroundColor White
Write-Host ""
Write-Host "  Full instructions: https://github.com/cderamos-2ct/shopvox-extractor/blob/main/INSTRUCTIONS.md"
Write-Host ""
