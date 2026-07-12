"""
Build standalone .exe for Network Doctor using PyInstaller.

Usage:
    python build_exe.py

Output:
    dist/Network Doctor.exe  (single portable .exe, no console window)
"""

import subprocess
import sys
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
MAIN_SCRIPT = os.path.join(ROOT, "network-doctor.py")
DIST_DIR = os.path.join(ROOT, "dist")
WORK_DIR = os.path.join(ROOT, "build_temp")
NAME = "Network Doctor"
ICON = os.path.join(ROOT, "icon.ico")  # pune un .ico aici daca ai; daca nu exista se sari

print("=" * 56)
print(f"  Building {NAME} — Standalone .exe")
print("=" * 56)
print()

for d in [DIST_DIR, WORK_DIR]:
    if os.path.isdir(d):
        shutil.rmtree(d)
        print(f"  Cleaned: {d}")

cmd = [
    sys.executable, "-m", "PyInstaller",
    "--onefile",
    "--windowed",           # fara fereastra cmd
    "--clean",
    "--noconfirm",
    f"--name={NAME}",
    f"--distpath={DIST_DIR}",
    f"--workpath={WORK_DIR}",
    f"--specpath={WORK_DIR}",
]

if ICON and os.path.isfile(ICON):
    cmd.append(f"--icon={ICON}")

cmd.append(MAIN_SCRIPT)

print(f"  Running: pyinstaller ...")
print(f"  Script:  {MAIN_SCRIPT}")
print()

result = subprocess.run(cmd, cwd=ROOT)

shutil.rmtree(WORK_DIR, ignore_errors=True)

if result.returncode != 0:
    print(f"\n  BUILD FAILED (exit code {result.returncode})")
    sys.exit(result.returncode)

exe_path = os.path.join(DIST_DIR, f"{NAME}.exe")
if os.path.isfile(exe_path):
    size_mb = os.path.getsize(exe_path) / (1024 * 1024)
    print()
    print("=" * 56)
    print(f"  BUILD SUCCESS!")
    print(f"  {NAME}.exe  ({size_mb:.1f} MB)")
    print(f"  Location: {exe_path}")
    print("=" * 56)
    print()
    print("  Ready. Double-click the .exe to launch.")
else:
    print("\n  Error: .exe was not generated.")
    sys.exit(1)
