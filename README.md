# Network Doctor

A desktop app for diagnosing and fixing internet problems without digging through cmd or terminal.

![Network Doctor](.github/screenshot.png)

## What it does

- One-click **Restart Router**: copies your saved admin password to the clipboard and opens the router's admin page at your default gateway
- Checks your connection status live and pings your router, Google DNS, Cloudflare, and google.com
- Shows your IP, gateway, and DNS config
- Download speed test
- One-click fixes: flush DNS, renew IP, reset Winsock, restart adapter, full network reset
- Optimizations: fast DNS (Cloudflare 1.1.1.1 + Google 8.8.8.8), disable adapter power-saving
- Saves your router admin password locally (base64-encoded, stored in `~/.network-doctor.json`) — never bundled with the app or synced anywhere
- Auto-detects your router IP from the default gateway — no hardcoded addresses
- Actions that need elevation trigger a UAC prompt only for that action, not for the whole app

Windows only.

## Download

Grab the latest `Network Doctor.exe` from [Releases](https://github.com/CyberKird/network-doctor/releases) — no Python required, no console window, no install. Double-click to run.

## Running from source

```bash
pip install -r requirements.txt
python network-doctor.py
```

Requires Python 3.10+.

## Building the .exe

```bash
pip install pyinstaller
python build_exe.py
```

Outputs a single-file, windowless `dist/Network Doctor.exe`.

## Password storage

The router password is saved in `~/.network-doctor.json` encoded as base64. It's not encrypted — this is a local convenience tool, not a password manager. Don't use it to store sensitive credentials.

## License

MIT
