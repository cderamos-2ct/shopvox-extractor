#!/usr/bin/env python3
"""
decrypt_cookies.py — Extract and decrypt Chrome cookies for shopvox.com domains.

Outputs a JSON array of cookie objects in Puppeteer's setCookie format.

macOS Chrome encryption format (v10):
  - AES-128-CBC
  - Key: PBKDF2-SHA1(rawKey, salt=b"saltysalt", iterations=1003, dklen=16)
  - Raw key: retrieved from macOS Keychain ("Chrome Safe Storage")
  - IV: 16-byte random value stored at bytes [3:19] of the encrypted blob
  - Ciphertext: bytes [19:] of the encrypted blob
  - Plaintext prefix: Chrome prepends 16 random nonce bytes before encrypting;
    the first decrypted block must be skipped.

Requires: pip install cryptography
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from hashlib import pbkdf2_hmac
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CHROME_COOKIES_PATH = Path.home() / "Library/Application Support/Google/Chrome/Default/Cookies"
DOMAINS = ["shopvox.com"]

# ---------------------------------------------------------------------------
# Keychain + key derivation
# ---------------------------------------------------------------------------

def get_safe_storage_key():
    """Retrieve the raw Chrome Safe Storage password from macOS Keychain."""
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
            f"ERROR: Could not retrieve Chrome Safe Storage key from Keychain.\n"
            f"stderr: {result.stderr.strip()}"
        )
    return result.stdout.strip().encode()


def derive_aes_key(raw_key):
    """Derive the 16-byte AES key from the raw Keychain password via PBKDF2-SHA1."""
    return pbkdf2_hmac("sha1", raw_key, b"saltysalt", 1003, dklen=16)

# ---------------------------------------------------------------------------
# Decryption
# ---------------------------------------------------------------------------

def decrypt_cookie_value(encrypted_value, aes_key):
    """
    Decrypt a single Chrome cookie value.

    Args:
        encrypted_value: bytes from the SQLite encrypted_value column.
        aes_key:         16-byte derived AES key.

    Returns:
        Plaintext string, or empty string on failure.
    """
    if not encrypted_value:
        return ""

    # Already plaintext (unencrypted cookie)
    if isinstance(encrypted_value, str):
        return encrypted_value

    # v10 prefix → AES-128-CBC (macOS Chrome)
    if encrypted_value[:3] == b"v10":
        try:
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            from cryptography.hazmat.backends import default_backend

            iv         = encrypted_value[3:19]    # 16-byte IV stored in blob
            ciphertext = encrypted_value[19:]      # actual AES-CBC ciphertext

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
            sys.exit(
                "ERROR: The 'cryptography' package is required.\n"
                "Install it with: pip3 install cryptography"
            )
        except Exception as exc:
            sys.stderr.write(f"WARNING: decrypt failed: {exc}\n")
            return ""

    # Unknown prefix — try raw UTF-8 decode as fallback
    try:
        return encrypted_value.decode("utf-8", errors="replace")
    except Exception:
        return ""

# ---------------------------------------------------------------------------
# Cookie extraction
# ---------------------------------------------------------------------------

def extract_cookies():
    """
    Open the Chrome SQLite Cookies DB, decrypt all shopvox.com cookies,
    and return them as a list of dicts matching Puppeteer's setCookie format.
    """
    if not CHROME_COOKIES_PATH.exists():
        sys.exit(
            f"ERROR: Chrome Cookies file not found at:\n"
            f"  {CHROME_COOKIES_PATH}\n"
            "Make sure Google Chrome is installed and has been opened at least once."
        )

    raw_key = get_safe_storage_key()
    aes_key = derive_aes_key(raw_key)

    # Chrome keeps the DB locked while running, so copy it to a temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    try:
        shutil.copy2(CHROME_COOKIES_PATH, tmp.name)
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
        value = decrypt_cookie_value(enc_val, aes_key)

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
