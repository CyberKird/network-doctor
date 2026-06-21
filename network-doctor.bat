@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs -WorkingDirectory '%~dp0'"
    exit /b
)
cd /d "%~dp0"
where pythonw.exe >nul 2>&1
if %errorlevel% equ 0 (
    start "" pythonw.exe "%~dp0network-doctor.py"
) else (
    where python.exe >nul 2>&1
    if %errorlevel% equ 0 (
        start /b python.exe "%~dp0network-doctor.py"
    ) else (
        echo Python not found in PATH. Install Python 3.10+ and try again.
        pause
    )
)
