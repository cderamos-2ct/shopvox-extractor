#!/usr/bin/env python3
"""
decrypt_cookies.py — Extract and decrypt Chrome cookies for shopvox.com domains.

Outputs a JSON array of cookie objects in Puppeteer's setCookie format.

Supported platforms:
  macOS  — AES-128-CBC v10 via macOS Keychain ("Chrome Safe Storage")
             PBKDF2-SHA1(key, salt=b"saltysalt", iterations=1003, dklen=16)
  Linux  — AES-128-CBC v10 with hardcoded password b"peanuts"
             PBKDF2-SHA1(b"peanuts", salt=b"saltysalt", iterations=1, dklen=16)
  Windows — AES-256-GCM v10 via DPAPI-protected master key (Chrome 80+)
             Master key stored in Local State JSON, encrypted with DPAPI.

Requires:
  All platforms: pip install cryptography
  Windows only:  pip install pywin32
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from hashlib import pbkdf2_hmac
from pathlib import Path

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

PLATFORM = sys.platform  # "darwin" | "win32" | "linux"

# ---------------------------------------------------------------------------
# Platform-specific cookie DB paths
# ---------------------------------------------------------------------------

def get_cookies_path():
    if PLATFORM == "darwin":
        return Path.home() / "Library/Application Support/Google/Chrome/Default/Cookies"
    elif PLATFORM == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        return Path(local_app_data) / r"Google\Chrome\User Data\Default\Cookies"
    else:
        # Linux
        return Path.home() / ".config/google-chrome/Default/Cookies"


DOMAINS = ["shopvox.com"]

# ---------------------------------------------------------------------------
# macOS: Keychain + key derivation
# ---------------------------------------------------------------------------

def get_macos_safe_storage_key():
    """Retrieve the raw Chrome Safe Storage password from macOS Keychain."""
    import subprocess
    result = subprocess.run(
        ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage", "-a", "Chrome"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # Retry without -a flag (older macOS / Chrome versions)
        result = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", "Chrome Safe Storage"],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        sys.exit(
            "ERROR: Could not retrieve Chrome Safe Storage key from Keychain.\n"
            f"stderr: {result.stderr.strip()}\n"
            "Make sure Google Chrome is installed and has been opened at least once."
        )
    return result.stdout.strip().encode()


def derive_aes_key_macos(raw_key):
    """Derive 16-byte AES key via PBKDF2-SHA1 with 1003 iterations (macOS)."""
    return pbkdf2_hmac("sha1", raw_key, b"saltysalt", 1003, dklen=16)


# ---------------------------------------------------------------------------
# Linux: hardcoded password + key derivation
# ---------------------------------------------------------------------------

def derive_aes_key_linux():
    """Derive 16-byte AES key via PBKDF2-SHA1 with 1 iteration (Linux)."""
    return pbkdf2_hmac("sha1", b"peanuts", b"saltysalt", 1, dklen=16)


# ---------------------------------------------------------------------------
# Windows: DPAPI master key extraction
# ---------------------------------------------------------------------------

def get_windows_master_key():
    """Read and decrypt the AES-256 master key from Chrome's Local State file."""
    import base64
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    local_state_path = Path(local_app_data) / r"Google\Chrome\User Data\Local State"

    if not local_state_path.exists():
        sys.exit(
            f"ERROR: Chrome Local State file not found at:\n"
            f"  {local_state_path}\n"
            "Make sure Google Chrome is installed and has been opened at least once."
        )

    with open(local_state_path, "r", encoding="utf-8") as f:
        local_state = json.load(f)

    encrypted_key_b64 = local_state.get("os_crypt", {}).get("encrypted_key")
    if not encrypted_key_b64:
        sys.exit("ERROR: Could not find os_crypt.encrypted_key in Chrome Local State.")

    encrypted_key = base64.b64decode(encrypted_key_b64)
    # Strip the 5-byte "DPAPI" prefix
    encrypted_key = encrypted_key[5:]

    try:
        import win32crypt
    except ImportError:
        sys.exit(
            "ERROR: The 'pywin32' package is required on Windows.\n"
            "Install it with: pip install pywin32"
        )

    master_key = win32crypt.CryptUnprotectData(encrypted_key, None, None, None, 0)[1]
    return master_key


# ---------------------------------------------------------------------------
# Decryption
# ---------------------------------------------------------------------------

def decrypt_cookie_value_cbc(encrypted_value, aes_key):
    """
    Decrypt a Chrome cookie using AES-128-CBC (macOS and Linux).

    Layout of encrypted blob (after v10 prefix):
      bytes [3:19]  — 16-byte IV
      bytes [19:]   — AES-CBC ciphertext (Chrome prepends 16 random nonce bytes
                       before encrypting, so skip first 16 decrypted bytes)

    Returns plaintext string or empty string on failure.
    """
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend

        iv         = encrypted_value[3:19]
        ciphertext = encrypted_value[19:]

        cipher    = Cipher(algorithms.AES(aes_key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        plaintext = decryptor.update(ciphertext) + decryptor.finalize()

        # Skip the 16-byte nonce prefix Chrome inserted before encrypting
        plaintext = plaintext[16:]

        # Remove PKCS7 padding
        padding = plaintext[-1]
        if 1 <= padding <= 16:
            plaintext = plaintext[:-padding]

        return plaintext.decode("utf-8", errors="replace")

    except ImportError:
        if PLATFORM == "darwin":
            hint = "Install it with: pip3 install cryptography"
        else:
            hint = "Install it with: pip install cryptography"
        sys.exit(f"ERROR: The 'cryptography' package is required.\n{hint}")
    except Exception as exc:
        sys.stderr.write(f"WARNING: CBC decrypt failed: {exc}\n")
        return ""


def decrypt_cookie_value_gcm(encrypted_value, master_key):
    """
    Decrypt a Chrome cookie using AES-256-GCM (Windows Chrome 80+).

    Layout of encrypted blob (after v10 prefix):
      bytes [3:15]   — 12-byte nonce
      bytes [15:-16] — ciphertext
      bytes [-16:]   — GCM authentication tag

    Returns plaintext string or empty string on failure.
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce      = encrypted_value[3:15]
        ciphertext = encrypted_value[15:-16]
        tag        = encrypted_value[-16:]

        aesgcm    = AESGCM(master_key)
        plaintext = aesgcm.decrypt(nonce, ciphertext + tag, None)

        return plaintext.decode("utf-8", errors="replace")

    except ImportError:
        sys.exit(
            "ERROR: The 'cryptography' package is required.\n"
            "Install it with: pip install cryptography"
        )
    except Exception as exc:
        sys.stderr.write(f"WARNING: GCM decrypt failed: {exc}\n")
        return ""


def decrypt_cookie_value(encrypted_value, key):
    """
    Dispatch decryption based on platform and encrypted value prefix.

    Args:
        encrypted_value: bytes from the SQLite encrypted_value column.
        key:             AES key (bytes): 16-byte CBC key on macOS/Linux,
                         or 32-byte GCM master key on Windows.

    Returns:
        Plaintext string, or empty string on failure.
    """
    if not encrypted_value:
        return ""

    # Already plaintext (unencrypted cookie)
    if isinstance(encrypted_value, str):
        return encrypted_value

    if encrypted_value[:3] == b"v10":
        if PLATFORM == "win32":
            return decrypt_cookie_value_gcm(encrypted_value, key)
        else:
            return decrypt_cookie_value_cbc(encrypted_value, key)

    # Unknown prefix — try raw UTF-8 decode as fallback
    try:
        return encrypted_value.decode("utf-8", errors="replace")
    except Exception:
        return ""

# ---------------------------------------------------------------------------
# Key acquisition (platform-dispatched)
# ---------------------------------------------------------------------------

def get_decryption_key():
    """Return the appropriate decryption key for the current platform."""
    if PLATFORM == "darwin":
        raw_key = get_macos_safe_storage_key()
        return derive_aes_key_macos(raw_key)
    elif PLATFORM == "win32":
        return get_windows_master_key()
    elif PLATFORM.startswith("linux"):
        return derive_aes_key_linux()
    else:
        sys.exit(
            f"ERROR: Unsupported platform '{PLATFORM}'.\n"
            "Supported platforms: macOS (darwin), Windows (win32), Linux (linux)."
        )

# ---------------------------------------------------------------------------
# Cookie extraction
# ---------------------------------------------------------------------------

def extract_cookies():
    """
    Open the Chrome SQLite Cookies DB, decrypt all shopvox.com cookies,
    and return them as a list of dicts matching Puppeteer's setCookie format.
    """
    chrome_cookies_path = get_cookies_path()

    if not chrome_cookies_path.exists():
        sys.exit(
            f"ERROR: Chrome Cookies file not found at:\n"
            f"  {chrome_cookies_path}\n"
            "Make sure Google Chrome is installed and has been opened at least once."
        )

    key = get_decryption_key()

    # Chrome keeps the DB locked while running, so copy it to a temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    try:
        shutil.copy2(chrome_cookies_path, tmp.name)
        tmp.close()

        con = sqlite3.connect(tmp.name)
        cur = con.cursor()

        # Build WHERE clause matching any of our domains (suffix match)
        where_clauses = " OR ".join("host_key LIKE ?" for _ in DOMAINS)
        params = [f"%{d}" for d in DOMAINS]

        cur.execute(
            f"""
            SELECT host_key, name, encrypted_value, path,
                   expires_utc, is_secure, is_httponly, samesite
            FROM   cookies
            WHERE  {where_clauses}
            """,
            params,
        )
        rows = cur.fetchall()
        con.close()

    finally:
        os.unlink(tmp.name)

    cookies = []
    for host, name, enc_val, path_, expires_utc, secure, httponly, samesite in rows:
        value = decrypt_cookie_value(enc_val, key)

        # Chrome stores expiry as microseconds since 1601-01-01; convert to Unix timestamp
        if expires_utc:
            expires = (expires_utc / 1_000_000) - 11_644_473_600
        else:
            expires = None

        samesite_map = {0: "None", 1: "Lax", 2: "Strict"}
        samesite_str = samesite_map.get(samesite, "None")

        cookies.append({
            "name":     name,
            "value":    value,
            "domain":   host,
            "path":     path_ or "/",
            "expires":  expires,
            "httpOnly": bool(httponly),
            "secure":   bool(secure),
            "sameSite": samesite_str,
        })

    return cookies


def main():
    cookies = extract_cookies()
    print(json.dumps(cookies))
    sys.stderr.write(f"Extracted {len(cookies)} shopvox.com cookies from Chrome.\n")


if __name__ == "__main__":
    main()
