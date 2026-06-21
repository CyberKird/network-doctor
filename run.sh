#!/usr/bin/env bash
# Linux / macOS launcher
cd "$(dirname "$0")"

if command -v python3 >/dev/null 2>&1; then
    python3 network-doctor.py
elif command -v python >/dev/null 2>&1; then
    python network-doctor.py
else
    echo "Python 3 not found. Install it first:"
    echo "  macOS:  brew install python"
    echo "  Ubuntu: sudo apt install python3 python3-pip"
    exit 1
fi
