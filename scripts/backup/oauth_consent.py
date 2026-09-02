#!/usr/bin/env python3
"""One-time helper: obtain a Google OAuth refresh token for the backup uploader.

Run this ONCE on your own computer (not in CI), logged in as the Google account
that owns the backup folder. It prints a refresh token to store as the GitHub
secret GOOGLE_OAUTH_REFRESH_TOKEN. Nothing is written to disk.

Prerequisites (Google Cloud console, same project as the Drive API):
  APIs & Services -> Credentials -> Create credentials -> OAuth client ID
  Application type: "Desktop app". Copy the client ID and client secret.
  APIs & Services -> OAuth consent screen -> Audience: set Publishing status to
  "In production" (refresh tokens minted while the app is in "Testing" expire
  after 7 days and the backups would start failing).

Usage:
  python3 scripts/backup/oauth_consent.py
  (prompts for client ID and secret, opens a browser, prints the refresh token)

Uses only the Python standard library.
"""
from __future__ import annotations

import getpass
import http.server
import json
import secrets
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

SCOPE = "https://www.googleapis.com/auth/drive"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"


class _Handler(http.server.BaseHTTPRequestHandler):
    result: dict = {}

    def do_GET(self):  # noqa: N802
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _Handler.result = {k: v[0] for k, v in params.items()}
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"You can close this tab and return to the terminal.")

    def log_message(self, *_):
        pass


def main() -> None:
    client_id = input("OAuth client ID: ").strip()
    client_secret = getpass.getpass("OAuth client secret (hidden): ").strip()
    if not client_id or not client_secret:
        sys.exit("client ID and secret are required")

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    redirect_uri = f"http://127.0.0.1:{server.server_port}"
    state = secrets.token_urlsafe(16)
    url = AUTH_URL + "?" + urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    threading.Thread(target=server.handle_request, daemon=True).start()
    print("\nOpening browser for Google consent. If it does not open, visit:\n" + url + "\n")
    webbrowser.open(url)
    server_thread_join_timeout = 600
    for _ in range(server_thread_join_timeout):
        if _Handler.result:
            break
        threading.Event().wait(1)
    server.server_close()

    res = _Handler.result
    if not res:
        sys.exit("timed out waiting for the browser redirect")
    if res.get("state") != state:
        sys.exit("state mismatch; aborting")
    if "code" not in res:
        sys.exit(f"consent failed: {res.get('error', 'no code returned')}")

    body = urllib.parse.urlencode(
        {
            "code": res["code"],
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
    ).encode()
    with urllib.request.urlopen(urllib.request.Request(TOKEN_URL, data=body)) as resp:
        token = json.load(resp)
    refresh = token.get("refresh_token")
    if not refresh:
        sys.exit("no refresh_token in response (revoke the app at myaccount.google.com/permissions and retry)")

    print("\nAdd these GitHub Actions secrets (Settings -> Secrets and variables -> Actions):")
    print("  GOOGLE_OAUTH_CLIENT_ID      = " + client_id)
    print("  GOOGLE_OAUTH_CLIENT_SECRET  = <the client secret you entered>")
    print("  GOOGLE_OAUTH_REFRESH_TOKEN  = " + refresh)
    print("\nDo not commit or share the refresh token.")


if __name__ == "__main__":
    main()
