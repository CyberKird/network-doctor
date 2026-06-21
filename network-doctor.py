import customtkinter as ctk
from tkinter import messagebox
from pathlib import Path
import subprocess
import threading
import socket
import webbrowser
import os
import json
import base64
import platform
import re
import time
import urllib.request

IS_WIN = os.name == "nt"
IS_MAC = platform.system() == "Darwin"

if IS_WIN:
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

CONFIG_FILE = Path.home() / ".network-doctor.json"

# ── Catppuccin Mocha ─────────────────────────────────────────────
C_BASE   = "#1e1e2e"
C_MANTLE = "#181825"
C_S0     = "#313244"
C_S1     = "#45475a"
C_S2     = "#585b70"
C_OV0    = "#6c7086"
C_OV1    = "#7f849c"
C_SUB0   = "#a6adc8"
C_SUB1   = "#bac2de"
C_TEXT   = "#cdd6f4"
C_MAUVE  = "#cba6f7"
C_RED    = "#f38ba8"
C_PEACH  = "#fab387"
C_YELLOW = "#f9e2af"
C_GREEN  = "#a6e3a1"
C_TEAL   = "#94e2d5"
C_SKY    = "#89dceb"
C_BLUE   = "#89b4fa"
C_LAVEN  = "#b4befe"
C_DARK   = "#1e1e2e"
# ─────────────────────────────────────────────────────────────────

PING_TARGETS_BASE = [
    ("Google DNS",     "8.8.8.8"),
    ("Cloudflare DNS", "1.1.1.1"),
    ("google.com",     "google.com"),
]

# Commands that require admin on Windows
_WIN_NEEDS_ADMIN = {"ip_renew", "winsock", "adapter_restart", "net_reset"}


def _detect_router_ip():
    try:
        if IS_WIN:
            out = subprocess.check_output("ipconfig", shell=True, text=True, timeout=5,
                                          stderr=subprocess.DEVNULL)
            for line in out.split("\n"):
                if "Default Gateway" in line and ":" in line:
                    ip = line.split(":")[-1].strip()
                    if re.match(r"\d+\.\d+\.\d+\.\d+", ip):
                        return ip
        elif IS_MAC:
            out = subprocess.check_output("route -n get default", shell=True, text=True,
                                          timeout=5, stderr=subprocess.DEVNULL)
            m = re.search(r"gateway:\s+(\S+)", out)
            if m:
                return m.group(1)
        else:
            out = subprocess.check_output("ip route show default", shell=True, text=True,
                                          timeout=5, stderr=subprocess.DEVNULL)
            m = re.search(r"default via (\S+)", out)
            if m:
                return m.group(1)
    except Exception:
        pass
    return "192.168.0.1"


def _is_admin():
    try:
        if IS_WIN:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except Exception:
        return False


def _load_config():
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text())
            pw = base64.b64decode(data.get("rp", "")).decode()
            return pw if pw else ""
    except Exception:
        pass
    return ""


def _save_config(password=""):
    try:
        encoded = base64.b64encode(password.encode()).decode() if password else ""
        CONFIG_FILE.write_text(json.dumps({"rp": encoded}))
    except Exception:
        pass


def _run_as_admin(cmd):
    try:
        if IS_WIN:
            ret = ctypes.windll.shell32.ShellExecuteW(
                None, "runas", "cmd.exe", f'/c {cmd} & pause', None, 1
            )
            return ret > 32
        elif IS_MAC:
            escaped = cmd.replace("\\", "\\\\").replace('"', '\\"')
            subprocess.Popen(["osascript", "-e",
                               f'do shell script "{escaped}" with administrator privileges'])
            return True
        else:
            for launcher in [
                ["pkexec", "bash", "-c", cmd],
                ["gnome-terminal", "--", "bash", "-c", f"sudo bash -c '{cmd}'; read"],
                ["xterm", "-e", f"sudo bash -c '{cmd}'; read"],
                ["konsole", "--", "bash", "-c", f"sudo bash -c '{cmd}'; read"],
            ]:
                try:
                    subprocess.Popen(launcher)
                    return True
                except FileNotFoundError:
                    continue
            return False
    except Exception:
        return False


def _get_active_adapter():
    try:
        if IS_WIN:
            out = subprocess.check_output(
                'powershell -Command "Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' }'
                ' | Select-Object -First 1 -ExpandProperty Name"',
                shell=True, timeout=8, text=True, stderr=subprocess.DEVNULL,
            )
            return out.strip().split("\n")[0].strip() or None
        elif IS_MAC:
            out = subprocess.check_output("route -n get default", shell=True, text=True,
                                          timeout=5, stderr=subprocess.DEVNULL)
            m = re.search(r"interface:\s+(\S+)", out)
            return m.group(1) if m else "en0"
        else:
            out = subprocess.check_output("ip route show default", shell=True, text=True,
                                          timeout=5, stderr=subprocess.DEVNULL)
            m = re.search(r"dev\s+(\S+)", out)
            return m.group(1) if m else None
    except Exception:
        return None


def _get_mac_network_service(iface):
    try:
        out = subprocess.check_output("networksetup -listnetworkserviceorder",
                                      shell=True, text=True, timeout=5,
                                      stderr=subprocess.DEVNULL)
        lines = out.strip().split("\n")
        for i, line in enumerate(lines):
            if f"Device: {iface})" in line and i > 0:
                return re.sub(r"^\(\d+\)\s+", "", lines[i - 1].strip())
    except Exception:
        pass
    return None


class NetworkDoctor(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Network Doctor")
        self.configure(fg_color=C_BASE)
        self._saved_password = _load_config()
        self._running = False
        self._router_ip = _detect_router_ip()
        self._ping_targets = [("Router", self._router_ip)] + PING_TARGETS_BASE
        self._last_ip_info = ""

        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        w = min(920, int(sw * 0.46))
        h = min(1060, int(sh * 0.90))
        self.geometry(f"{w}x{h}")
        self.minsize(740, 760)

        self._build_ui()
        self.after(600, self._auto_check)

    # ══════════════════════════════════════════════════════════════
    # UI
    # ══════════════════════════════════════════════════════════════
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=0)
        self.grid_rowconfigure(1, weight=0)
        self.grid_rowconfigure(2, weight=1)

        PX = 22

        # ── Header ───────────────────────────────────────────────
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=PX, pady=(22, 6))

        ctk.CTkLabel(
            header, text="◆",
            font=ctk.CTkFont(size=20), text_color=C_MAUVE,
        ).pack(side="left")

        ctk.CTkLabel(
            header, text="  Network Doctor",
            font=ctk.CTkFont(size=22, weight="bold"), text_color=C_TEXT,
        ).pack(side="left")

        ctk.CTkLabel(
            header, text="v2.0",
            font=ctk.CTkFont(size=10), text_color=C_OV1,
            fg_color=C_S1, corner_radius=4, padx=7, pady=3,
        ).pack(side="left", padx=10)

        os_label = "Windows" if IS_WIN else ("macOS" if IS_MAC else "Linux")
        ctk.CTkLabel(
            header, text=f"Diagnose & fix your internet  ·  {os_label}",
            font=ctk.CTkFont(size=11), text_color=C_OV1,
        ).pack(side="right")

        # ── Status bar ───────────────────────────────────────────
        sb = ctk.CTkFrame(
            self, fg_color=C_S0, corner_radius=10,
            border_width=1, border_color=C_S1,
        )
        sb.grid(row=1, column=0, sticky="ew", padx=PX, pady=(0, 14))

        self.status_dot = ctk.CTkLabel(
            sb, text="●",
            font=ctk.CTkFont(size=16), text_color=C_OV0,
        )
        self.status_dot.pack(side="left", padx=(14, 6), pady=12)

        self.status_label = ctk.CTkLabel(
            sb, text="Checking connection...",
            font=ctk.CTkFont(size=12, weight="bold"), text_color=C_SUB0,
        )
        self.status_label.pack(side="left", pady=12)

        self.progress_bar = ctk.CTkProgressBar(
            sb, width=160, height=6,
            progress_color=C_MAUVE, fg_color=C_S1, corner_radius=3,
        )
        self.progress_bar.pack(side="right", padx=14, pady=12)
        self.progress_bar.set(0)

        # Refresh button in status bar
        ctk.CTkButton(
            sb, text="↺",
            command=self._auto_check,
            width=32, height=28, corner_radius=6,
            font=ctk.CTkFont(size=14),
            fg_color=C_S1, hover_color=C_S2, text_color=C_SUB0,
        ).pack(side="right", padx=(0, 6), pady=12)

        # ── Scroll area ──────────────────────────────────────────
        self.scroll = ctk.CTkScrollableFrame(
            self, fg_color="transparent", corner_radius=0,
            scrollbar_button_color=C_S1,
            scrollbar_button_hover_color=C_S2,
        )
        self.scroll.grid(row=2, column=0, sticky="nsew", padx=PX, pady=(0, 14))
        self.scroll.grid_columnconfigure(0, weight=1)

        self._build_router()
        self._build_optimizations()
        self._build_fixes()
        self._build_diag()
        self._build_log()

    def _section(self, title, icon, row, accent=C_MAUVE, pady=(0, 10)):
        card = ctk.CTkFrame(
            self.scroll, fg_color=C_S0, corner_radius=12,
            border_width=1, border_color=C_S1,
        )
        card.grid(row=row, column=0, sticky="ew", pady=pady)
        card.grid_columnconfigure(0, weight=1)

        hdr = ctk.CTkFrame(card, fg_color="transparent")
        hdr.pack(fill="x", padx=16, pady=(12, 8))

        ctk.CTkLabel(
            hdr, text="●",
            font=ctk.CTkFont(size=10), text_color=accent,
        ).pack(side="left", padx=(0, 8))

        ctk.CTkLabel(
            hdr, text=f"{icon}  {title}",
            font=ctk.CTkFont(size=13, weight="bold"), text_color=C_TEXT,
        ).pack(side="left")

        ctk.CTkFrame(card, fg_color=C_S1, height=1, corner_radius=0).pack(fill="x", padx=16)

        body = ctk.CTkFrame(card, fg_color="transparent")
        body.pack(fill="x", padx=16, pady=(10, 14))

        return body

    def _hint(self, parent, text, pady=(0, 2)):
        ctk.CTkLabel(
            parent, text=text,
            font=ctk.CTkFont(size=10), text_color=C_OV0,
            anchor="w", wraplength=700,
        ).pack(anchor="w", pady=pady)

    def _divider(self, parent):
        ctk.CTkFrame(parent, fg_color=C_S1, height=1, corner_radius=0).pack(fill="x", pady=(6, 10))

    # ──────────────────────────────────────────────────────────────
    # Router Access
    # ──────────────────────────────────────────────────────────────
    def _build_router(self):
        c = self._section("Router Access", "↗", 0, accent=C_BLUE)

        btn_row = ctk.CTkFrame(c, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 4))
        btn_row.grid_columnconfigure(0, weight=1)
        btn_row.grid_columnconfigure(1, weight=1)

        ctk.CTkButton(
            btn_row, text="↗  Open Router Page",
            command=self._open_router,
            height=38, corner_radius=8,
            font=ctk.CTkFont(size=13, weight="bold"),
            fg_color=C_BLUE, hover_color="#74a9f0", text_color=C_DARK,
        ).grid(row=0, column=0, sticky="ew", padx=(0, 5))

        ctk.CTkButton(
            btn_row, text="⧉  Open + Copy Password",
            command=self._open_and_copy,
            height=38, corner_radius=8,
            font=ctk.CTkFont(size=12, weight="bold"),
            fg_color=C_MAUVE, hover_color="#b690e5", text_color=C_DARK,
        ).grid(row=0, column=1, sticky="ew", padx=(5, 0))

        self._hint(c, f"Opens http://{self._router_ip}  ·  Right button also copies the saved password first")

        ctk.CTkButton(
            c, text="↺  Reboot Guide",
            command=self._reboot_guide,
            height=30, corner_radius=8,
            font=ctk.CTkFont(size=11),
            fg_color=C_S1, hover_color=C_S2, text_color=C_SUB0,
        ).pack(fill="x", pady=(8, 0))
        self._hint(c, "Step-by-step for rebooting via admin panel or physical unplug")

        self._divider(c)

        pw_card = ctk.CTkFrame(c, fg_color=C_MANTLE, corner_radius=8)
        pw_card.pack(fill="x")

        pw_top = ctk.CTkFrame(pw_card, fg_color="transparent")
        pw_top.pack(fill="x", padx=12, pady=(10, 4))

        ctk.CTkLabel(
            pw_top, text="Admin Password",
            font=ctk.CTkFont(size=11, weight="bold"), text_color=C_SUB1,
        ).pack(side="left")

        self.pw_status = ctk.CTkLabel(
            pw_top,
            text="✔ Saved" if self._saved_password else "",
            font=ctk.CTkFont(size=11), text_color=C_GREEN,
        )
        self.pw_status.pack(side="right")

        pw_ctrl = ctk.CTkFrame(pw_card, fg_color="transparent")
        pw_ctrl.pack(fill="x", padx=12, pady=(0, 10))

        self.pw_var = ctk.StringVar(value=self._saved_password)
        self.pw_entry = ctk.CTkEntry(
            pw_ctrl, textvariable=self.pw_var, show="*",
            height=34, corner_radius=6,
            fg_color=C_S0, border_color=C_S1, text_color=C_TEXT,
            placeholder_text="Enter router admin password...",
        )
        self.pw_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))

        self.pw_show = ctk.CTkSwitch(
            pw_ctrl, text="Show",
            command=self._toggle_pw_vis,
            width=40, switch_width=36, switch_height=18,
            font=ctk.CTkFont(size=11), text_color=C_SUB0,
            progress_color=C_MAUVE,
        )
        self.pw_show.pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            pw_ctrl, text="Copy",
            command=self._copy_password,
            width=62, height=32, corner_radius=6,
            font=ctk.CTkFont(size=11, weight="bold"),
            fg_color=C_S1, hover_color=C_S2, text_color=C_TEXT,
        ).pack(side="left", padx=(0, 4))

        ctk.CTkButton(
            pw_ctrl, text="Save",
            command=self._save_password_action,
            width=62, height=32, corner_radius=6,
            font=ctk.CTkFont(size=11, weight="bold"),
            fg_color=C_GREEN, hover_color="#8fd18b", text_color=C_DARK,
        ).pack(side="left")

    # ──────────────────────────────────────────────────────────────
    # Optimizations
    # ──────────────────────────────────────────────────────────────
    def _build_optimizations(self):
        c = self._section("Optimizations", "⚡", 1, accent=C_YELLOW)

        opts = [
            (
                "⚡  Set Fast DNS  (Cloudflare 1.1.1.1 + Google 8.8.8.8)",
                C_TEAL, "#7bc8bc", self._set_fast_dns,
                "Often the single biggest speed improvement — requires admin elevation.",
            ),
            (
                "⏻  Prevent Adapter Sleep",
                C_SKY, "#72cadd", self._prevent_wifi_sleep,
                "Stops the OS from powering down your adapter — fixes random disconnects — requires admin.",
            ),
        ]

        for label, color, hover, cmd, desc in opts:
            opt_card = ctk.CTkFrame(c, fg_color=C_MANTLE, corner_radius=8)
            opt_card.pack(fill="x", pady=(0, 8))
            inner = ctk.CTkFrame(opt_card, fg_color="transparent")
            inner.pack(fill="x", padx=12, pady=10)
            ctk.CTkButton(
                inner, text=label, command=cmd,
                height=34, corner_radius=6,
                font=ctk.CTkFont(size=12, weight="bold"),
                fg_color=color, hover_color=hover, text_color=C_DARK,
            ).pack(fill="x", pady=(0, 5))
            ctk.CTkLabel(
                inner, text=desc,
                font=ctk.CTkFont(size=10), text_color=C_OV1,
                anchor="w", wraplength=680,
            ).pack(anchor="w")

    # ──────────────────────────────────────────────────────────────
    # Quick Fixes
    # ──────────────────────────────────────────────────────────────
    def _fixes_config(self):
        if IS_WIN:
            return [
                ("Flush DNS",       "dns_flush",       C_BLUE,  "#74a9f0", "Clears stale DNS — fixes 'site not found'"),
                ("Renew IP",        "ip_renew",        C_BLUE,  "#74a9f0", "Requests fresh IP — fixes 'no valid IP'"),
                ("Reset Winsock",   "winsock",         C_PEACH, "#e89a70", "Rebuilds network sockets — partial connectivity"),
                ("Restart Adapter", "adapter_restart", C_PEACH, "#e89a70", "Off/on adapter — like replugging"),
            ]
        elif IS_MAC:
            return [
                ("Flush DNS",       "dns_flush",       C_BLUE,  "#74a9f0", "Clears stale DNS — fixes 'site not found'"),
                ("Renew IP",        "ip_renew",        C_BLUE,  "#74a9f0", "Requests fresh DHCP lease"),
                ("Restart DNS",     "winsock",         C_PEACH, "#e89a70", "Restarts mDNSResponder"),
                ("Restart Adapter", "adapter_restart", C_PEACH, "#e89a70", "Brings interface down then back up"),
            ]
        else:
            return [
                ("Flush DNS",       "dns_flush",       C_BLUE,  "#74a9f0", "Clears systemd-resolve DNS cache"),
                ("Renew IP",        "ip_renew",        C_BLUE,  "#74a9f0", "Requests fresh DHCP lease"),
                ("Restart Network", "winsock",         C_PEACH, "#e89a70", "Restarts NetworkManager"),
                ("Restart Adapter", "adapter_restart", C_PEACH, "#e89a70", "Brings interface down then back up"),
            ]

    def _build_fixes(self):
        c = self._section("Quick Fixes", "⚙", 2, accent=C_PEACH)

        grid = ctk.CTkFrame(c, fg_color="transparent")
        grid.pack(fill="x", pady=(0, 6))
        grid.grid_columnconfigure(0, weight=1)
        grid.grid_columnconfigure(1, weight=1)

        for i, (label, key, color, hover, desc) in enumerate(self._fixes_config()):
            col = i % 2
            row_idx = i // 2
            px = (0, 5) if col == 0 else (5, 0)
            card = ctk.CTkFrame(grid, fg_color=C_MANTLE, corner_radius=8)
            card.grid(row=row_idx, column=col, sticky="nsew", padx=px, pady=(0, 6))
            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(fill="x", padx=10, pady=10)
            ctk.CTkButton(
                inner, text=label,
                command=lambda k=key: self._run_fix(k),
                height=32, corner_radius=6,
                font=ctk.CTkFont(size=12, weight="bold"),
                fg_color=color, hover_color=hover, text_color=C_DARK,
            ).pack(fill="x", pady=(0, 4))
            ctk.CTkLabel(
                inner, text=desc,
                font=ctk.CTkFont(size=10), text_color=C_OV0,
                anchor="w", wraplength=220,
            ).pack(anchor="w")

        full_card = ctk.CTkFrame(c, fg_color=C_MANTLE, corner_radius=8)
        full_card.pack(fill="x")
        inner = ctk.CTkFrame(full_card, fg_color="transparent")
        inner.pack(fill="x", padx=10, pady=10)
        ctk.CTkButton(
            inner,
            text="⚠  Full Reset  —  All fixes at once (last resort before rebooting)",
            command=lambda: self._run_fix("net_reset"),
            height=34, corner_radius=6,
            font=ctk.CTkFont(size=12, weight="bold"),
            fg_color=C_RED, hover_color="#e06880", text_color=C_DARK,
        ).pack(fill="x")

    # ──────────────────────────────────────────────────────────────
    # Diagnostics
    # ──────────────────────────────────────────────────────────────
    def _build_diag(self):
        c = self._section("Diagnostics", "◎", 3, accent=C_GREEN)

        btn_row = ctk.CTkFrame(c, fg_color="transparent")
        btn_row.pack(fill="x", pady=(0, 10))

        self.btn_diag = ctk.CTkButton(
            btn_row, text="▶  Run All Tests",
            command=self._run_all_diags,
            height=38, corner_radius=8,
            font=ctk.CTkFont(size=13, weight="bold"),
            fg_color=C_GREEN, hover_color="#8fd18b", text_color=C_DARK,
        )
        self.btn_diag.pack(side="left")

        ctk.CTkButton(
            btn_row, text="⚡  Speed Test",
            command=self._run_speed_test,
            height=38, corner_radius=8,
            font=ctk.CTkFont(size=12, weight="bold"),
            fg_color=C_MAUVE, hover_color="#b690e5", text_color=C_DARK,
        ).pack(side="left", padx=(8, 0))

        ctk.CTkLabel(
            btn_row,
            text="  Pings targets, checks DNS, shows IP config",
            font=ctk.CTkFont(size=11), text_color=C_OV0, anchor="w",
        ).pack(side="left")

        # Ping grid 2×2
        ping_grid = ctk.CTkFrame(c, fg_color="transparent")
        ping_grid.pack(fill="x", pady=(0, 8))
        ping_grid.grid_columnconfigure(0, weight=1)
        ping_grid.grid_columnconfigure(1, weight=1)

        self.ping_labels = {}
        for i, (label, target) in enumerate(self._ping_targets):
            col = i % 2
            row_idx = i // 2
            px = (0, 5) if col == 0 else (5, 0)
            ping_card = ctk.CTkFrame(ping_grid, fg_color=C_MANTLE, corner_radius=8)
            ping_card.grid(row=row_idx, column=col, sticky="nsew", padx=px, pady=(0, 6))
            inner = ctk.CTkFrame(ping_card, fg_color="transparent")
            inner.pack(fill="x", padx=12, pady=8)
            top_row = ctk.CTkFrame(inner, fg_color="transparent")
            top_row.pack(fill="x")
            ctk.CTkLabel(
                top_row, text=label,
                font=ctk.CTkFont(size=11, weight="bold"), text_color=C_SUB1,
            ).pack(side="left")
            lbl = ctk.CTkLabel(
                top_row, text="—",
                font=ctk.CTkFont(size=11, weight="bold"), text_color=C_OV0,
            )
            lbl.pack(side="right")
            self.ping_labels[label] = lbl
            ctk.CTkLabel(
                inner, text=target,
                font=ctk.CTkFont(size=10), text_color=C_OV0, anchor="w",
            ).pack(anchor="w")

        # IP info card with copy button
        ip_card = ctk.CTkFrame(c, fg_color=C_MANTLE, corner_radius=8)
        ip_card.pack(fill="x")

        ip_toolbar = ctk.CTkFrame(ip_card, fg_color="transparent")
        ip_toolbar.pack(fill="x", padx=12, pady=(8, 0))

        ctk.CTkLabel(
            ip_toolbar, text="IP Configuration",
            font=ctk.CTkFont(size=10, weight="bold"), text_color=C_OV1,
        ).pack(side="left")

        ctk.CTkButton(
            ip_toolbar, text="Copy",
            command=self._copy_ip_info,
            width=50, height=22, corner_radius=5,
            font=ctk.CTkFont(size=10),
            fg_color=C_S1, hover_color=C_S2, text_color=C_SUB0,
        ).pack(side="right")

        self.info_label = ctk.CTkLabel(
            ip_card,
            text="Run diagnostics to see your IP configuration",
            font=ctk.CTkFont(family="Consolas", size=10),
            text_color=C_OV0, anchor="w", justify="left",
        )
        self.info_label.pack(anchor="w", padx=12, pady=(4, 10))

    # ──────────────────────────────────────────────────────────────
    # Log
    # ──────────────────────────────────────────────────────────────
    def _build_log(self):
        c = self._section("Log", "≡", 4, accent=C_LAVEN)

        toolbar = ctk.CTkFrame(c, fg_color="transparent")
        toolbar.pack(fill="x", pady=(0, 6))
        ctk.CTkLabel(
            toolbar, text="Activity log — all actions and results",
            font=ctk.CTkFont(size=10), text_color=C_OV0,
        ).pack(side="left")
        ctk.CTkButton(
            toolbar, text="Clear",
            command=self._clear_log,
            width=54, height=26, corner_radius=6,
            font=ctk.CTkFont(size=10),
            fg_color=C_S1, hover_color=C_S2, text_color=C_SUB0,
        ).pack(side="right")

        self.log = ctk.CTkTextbox(
            c, height=150,
            font=("Consolas", 11),
            fg_color=C_MANTLE, text_color=C_TEXT,
            corner_radius=8, border_width=1, border_color=C_S1,
        )
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

    # ══════════════════════════════════════════════════════════════
    # Optimization actions
    # ══════════════════════════════════════════════════════════════
    def _set_fast_dns(self):
        adapter = _get_active_adapter()
        if not adapter:
            messagebox.showwarning("No Adapter", "Could not find an active network adapter.")
            return

        if IS_WIN:
            ok = messagebox.askyesno(
                "Set Fast DNS",
                f"This will set your adapter ('{adapter}') to use:\n\n"
                f"  Primary DNS:   1.1.1.1 (Cloudflare)\n"
                f"  Secondary DNS: 8.8.8.8 (Google)\n\n"
                f"A UAC prompt will appear. Continue?"
            )
            if not ok:
                return
            cmd = (
                f'netsh interface ip set dns name="{adapter}" source=static addr=1.1.1.1'
                f' && netsh interface ip add dns name="{adapter}" addr=8.8.8.8 index=2'
            )
        elif IS_MAC:
            service = _get_mac_network_service(adapter) or adapter
            ok = messagebox.askyesno(
                "Set Fast DNS",
                f"Set '{service}' ({adapter}) to use:\n\n"
                f"  Primary DNS:   1.1.1.1 (Cloudflare)\n"
                f"  Secondary DNS: 8.8.8.8 (Google)\n\n"
                f"Password prompt will appear. Continue?"
            )
            if not ok:
                return
            cmd = f'networksetup -setdnsservers "{service}" 1.1.1.1 8.8.8.8'
        else:
            ok = messagebox.askyesno(
                "Set Fast DNS",
                f"Set '{adapter}' to use:\n\n"
                f"  Primary DNS:   1.1.1.1 (Cloudflare)\n"
                f"  Secondary DNS: 8.8.8.8 (Google)\n\n"
                f"Requires admin. Continue?"
            )
            if not ok:
                return
            cmd = (
                f"resolvectl dns {adapter} 1.1.1.1 8.8.8.8 2>/dev/null || "
                f"nmcli con mod \"$(nmcli -g NAME,DEVICE con show --active"
                f" | grep -w '{adapter}' | cut -d: -f1)\" ipv4.dns '1.1.1.1 8.8.8.8'"
            )

        if _run_as_admin(cmd):
            self._log("[OPTIMIZE] DNS set to Cloudflare (1.1.1.1) + Google (8.8.8.8)")
            self._log("          Changes take effect immediately.")
        else:
            self._log("[OPTIMIZE] DNS change cancelled or failed.")

    def _prevent_wifi_sleep(self):
        adapter = _get_active_adapter()

        if IS_WIN:
            if not adapter:
                messagebox.showwarning("No Adapter", "Could not find an active network adapter.")
                return
            ok = messagebox.askyesno(
                "Prevent Adapter Sleep",
                f"This will stop Windows from powering down your network adapter\n"
                f"('{adapter}') to save power. Fixes random disconnects.\n\n"
                f"A UAC prompt will appear. Continue?"
            )
            if not ok:
                return
            cmd = (
                f'powercfg /setdcvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'
                f' 12bbebe6-58d6-4636-95bb-3217ef867c1a 0'
                f' && powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'
                f' 12bbebe6-58d6-4636-95bb-3217ef867c1a 0'
                f' && powershell -Command "$a = Get-NetAdapter -Name \'{adapter}\';'
                f' $a | Disable-NetAdapterPowerManagement -Confirm:$false"'
            )
            if _run_as_admin(cmd):
                self._log(f"[OPTIMIZE] Power saving disabled for '{adapter}'")
            else:
                self._log("[OPTIMIZE] Operation cancelled or failed.")

        elif IS_MAC:
            messagebox.showinfo(
                "Adapter Sleep — macOS",
                "macOS handles adapter power management at the OS level.\n\n"
                "To reduce random disconnects:\n"
                "  System Settings -> Battery -> disable 'Enable Power Nap'\n"
                "  System Settings -> Network -> Wi-Fi -> uncheck 'Ask to join hotspots'"
            )
            self._log("[OPTIMIZE] macOS: see System Settings > Battery for sleep options")

        else:
            if not adapter:
                messagebox.showwarning("No Adapter", "Could not find an active network adapter.")
                return
            ok = messagebox.askyesno(
                "Disable Adapter Power Saving",
                f"Disable WiFi power saving for '{adapter}'.\n"
                f"Requires admin. Continue?"
            )
            if not ok:
                return
            cmd = (
                f"iw dev {adapter} set power_save off 2>/dev/null || "
                f"iwconfig {adapter} power off 2>/dev/null"
            )
            if _run_as_admin(cmd):
                self._log(f"[OPTIMIZE] Power saving disabled for '{adapter}'")
            else:
                self._log("[OPTIMIZE] Operation cancelled or failed.")

    # ══════════════════════════════════════════════════════════════
    # Actions
    # ══════════════════════════════════════════════════════════════
    def _set_loading(self, active):
        self._running = active
        if active:
            self.progress_bar.start()
        else:
            self.progress_bar.stop()
            self.progress_bar.set(0)

    def _open_router(self):
        self._log(f"[Router] Opening http://{self._router_ip} ...")
        webbrowser.open(f"http://{self._router_ip}")

    def _toggle_pw_vis(self):
        show = self.pw_show.get()
        self.pw_entry.configure(show="" if show else "*")

    def _copy_password(self):
        pw = self.pw_var.get().strip()
        if pw:
            self.clipboard_clear()
            self.clipboard_append(pw)
            self._log("[Router] Password copied to clipboard")
        else:
            self._log("[Router] No password set — type it first")

    def _save_password_action(self):
        pw = self.pw_var.get().strip()
        if pw:
            _save_config(pw)
            self._saved_password = pw
            self.pw_status.configure(text="✔ Saved", text_color=C_GREEN)
            self._log("[Router] Password saved for future sessions")
        else:
            _save_config("")
            self._saved_password = ""
            self.pw_status.configure(text="Cleared", text_color=C_RED)
            self._log("[Router] Saved password cleared")

    def _open_and_copy(self):
        self._copy_password()
        self._open_router()

    def _reboot_guide(self):
        messagebox.showinfo(
            "Router Reboot Guide",
            "Option A — Via admin panel:\n"
            "  1. Open Router Page\n"
            "  2. Log in -> 'System' or 'Maintenance'\n"
            "  3. Click 'Reboot' / 'Restart'\n"
            "  4. Wait 2-3 minutes\n\n"
            "Option B — Physically:\n"
            "  1. Unplug the power cable\n"
            "  2. Wait 30 seconds\n"
            "  3. Plug it back in\n"
            "  4. Wait 2-3 minutes for lights"
        )

    def _run_fix(self, fix_type):
        adapter = _get_active_adapter()
        iface = adapter or ("en0" if IS_MAC else "eth0")

        if IS_WIN:
            commands = {
                "dns_flush":       ("ipconfig /flushdns", "Flushing DNS cache"),
                "ip_renew":        ("ipconfig /release && ipconfig /renew", "Renewing IP address"),
                "winsock":         ("netsh winsock reset", "Resetting Winsock"),
                "adapter_restart": (
                    'powershell -Command "Get-NetAdapter | Where-Object {$_.Status -eq \'Up\'}'
                    ' | Select-Object -First 1 | Restart-NetAdapter"',
                    "Restarting network adapter"
                ),
                "net_reset": (
                    "netsh int ip reset && netsh winsock reset && ipconfig /flushdns",
                    "Full network reset"
                ),
            }
        elif IS_MAC:
            commands = {
                "dns_flush":       ("dscacheutil -flushcache && killall -HUP mDNSResponder",
                                    "Flushing DNS cache"),
                "ip_renew":        (f"ipconfig set {iface} DHCP", "Renewing IP address"),
                "winsock":         ("killall -HUP mDNSResponder", "Restarting DNS resolver"),
                "adapter_restart": (f"ifconfig {iface} down && sleep 1 && ifconfig {iface} up",
                                    "Restarting adapter"),
                "net_reset": (
                    f"dscacheutil -flushcache && killall -HUP mDNSResponder"
                    f" && ipconfig set {iface} DHCP",
                    "Full network reset"
                ),
            }
        else:
            commands = {
                "dns_flush": (
                    "resolvectl flush-caches 2>/dev/null || systemd-resolve --flush-caches 2>/dev/null",
                    "Flushing DNS cache"
                ),
                "ip_renew": (
                    f"dhclient -r {iface} 2>/dev/null; dhclient {iface} 2>/dev/null",
                    "Renewing IP (DHCP)"
                ),
                "winsock": (
                    "systemctl restart NetworkManager 2>/dev/null || service networking restart 2>/dev/null",
                    "Restarting NetworkManager"
                ),
                "adapter_restart": (
                    f"ip link set {iface} down && sleep 1 && ip link set {iface} up",
                    "Restarting adapter"
                ),
                "net_reset": (
                    f"resolvectl flush-caches 2>/dev/null; ip link set {iface} down;"
                    f" sleep 1; ip link set {iface} up; dhclient {iface} 2>/dev/null",
                    "Full network reset"
                ),
            }

        cmd, msg = commands.get(fix_type, ("", ""))
        if not cmd:
            return

        self._log(f"\n[FIX] {msg}")
        self._set_loading(True)

        # Windows commands that need admin but aren't running elevated yet
        if IS_WIN and fix_type in _WIN_NEEDS_ADMIN and not _is_admin():
            self._log("  Requires admin — opening elevated prompt...")
            if _run_as_admin(cmd):
                self._log("  Done (check the elevated window for output).\n")
            else:
                self._log("  Cancelled or failed to elevate.\n")
            self.after(0, self._set_loading, False)
            return

        threading.Thread(target=self._exec, args=(cmd,), daemon=True).start()

    def _run_all_diags(self):
        self._log("\n" + "-" * 44)
        self._log("  Running full diagnostics ...")
        self._log("-" * 44)
        self.info_label.configure(text="")
        self._set_loading(True)
        threading.Thread(target=self._diag_worker, daemon=True).start()

    def _run_speed_test(self):
        self._log("\n[SPEED] Starting download speed test...")
        self._set_loading(True)
        threading.Thread(target=self._speed_test_worker, daemon=True).start()

    def _speed_test_worker(self):
        url = "https://speed.cloudflare.com/__down?bytes=5000000"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "network-doctor/2.0"})
            t0 = time.perf_counter()
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
            elapsed = time.perf_counter() - t0
            mb = len(data) / 1_000_000
            mbps = (mb * 8) / elapsed
            self._log(f"[SPEED] {mbps:.1f} Mbps  ({mb:.1f} MB in {elapsed:.1f}s)")
        except Exception as e:
            self._log(f"[SPEED] Failed: {e}")
        finally:
            self.after(0, self._set_loading, False)

    def _diag_worker(self):
        online = self._check_internet()
        self.after(0, self._set_status, online)

        info_text = self._collect_ip_info()
        self._last_ip_info = info_text
        self.after(0, self.info_label.configure, {"text": info_text, "text_color": C_SUB0})

        for label, target in self._ping_targets:
            ms = self._ping(target)
            ok = ms is not None
            color = C_GREEN if ok else C_RED
            text = f"{ms} ms" if ok else "TIMEOUT"
            self.after(0, self._update_ping, label, text, color)
            self._log(f"  Ping {label:<16} {text}")

        dns_ok = self._check_dns()
        self._log(f"  DNS resolution         {'OK' if dns_ok else 'FAILED'}")
        self._log("-" * 44 + "\n")
        self.after(0, self._set_loading, False)

    def _collect_ip_info(self):
        try:
            if IS_WIN:
                out = self._exec_sync("ipconfig")
                lines = [
                    l.strip() for l in out.split("\n")
                    if any(k in l for k in ["IPv4", "Default Gateway", "DNS Server", "Subnet Mask"])
                ]
                return "\n".join(lines) if lines else "No IP info found"
            else:
                cmd = "ip addr && ip route" if not IS_MAC else "ifconfig && netstat -rn | grep -E 'default|UG'"
                out = self._exec_sync(cmd)
                lines = []
                for line in out.split("\n"):
                    s = line.strip()
                    if s.startswith("inet ") or "default" in s.lower() or re.match(r"\d+:", s):
                        lines.append(s)
                return "\n".join(lines[:30]) if lines else out[:500]
        except Exception as e:
            return f"Could not read network info: {e}"

    def _copy_ip_info(self):
        if self._last_ip_info:
            self.clipboard_clear()
            self.clipboard_append(self._last_ip_info)
            self._log("[Diag] IP info copied to clipboard")
        else:
            self._log("[Diag] Run diagnostics first")

    def _auto_check(self):
        threading.Thread(target=self._auto_check_worker, daemon=True).start()

    def _auto_check_worker(self):
        online = self._check_internet()
        self.after(0, self._set_status, online)

    def _set_status(self, online):
        if online:
            self.status_dot.configure(text_color=C_GREEN)
            self.status_label.configure(text="Connected", text_color=C_GREEN)
        else:
            self.status_dot.configure(text_color=C_RED)
            self.status_label.configure(text="No Internet", text_color=C_RED)

    def _update_ping(self, label, text, color):
        if label in self.ping_labels:
            self.ping_labels[label].configure(text=text, text_color=color)

    # ══════════════════════════════════════════════════════════════
    # Network
    # ══════════════════════════════════════════════════════════════
    def _check_internet(self):
        try:
            socket.create_connection(("8.8.8.8", 53), timeout=2)
            return True
        except Exception:
            return False

    def _check_dns(self):
        try:
            socket.gethostbyname("google.com")
            return True
        except Exception:
            return False

    def _ping(self, target):
        try:
            param = "-n 1 -w 2000" if IS_WIN else "-c 1 -W 2"
            out = subprocess.check_output(
                f"ping {param} {target}", shell=True, stderr=subprocess.STDOUT,
                timeout=4, text=True,
            )
            for line in out.split("\n"):
                low = line.lower()
                if "time=" in low:
                    return low.split("time=")[1].split("ms")[0].strip()
                if "time<" in low:
                    return "<1"
            return None
        except Exception:
            return None

    def _exec_sync(self, cmd):
        try:
            return subprocess.check_output(
                cmd, shell=True, stderr=subprocess.STDOUT, timeout=15, text=True,
            )
        except Exception as e:
            return str(e)

    def _exec(self, cmd):
        try:
            out = subprocess.check_output(
                cmd, shell=True, stderr=subprocess.STDOUT, timeout=30, text=True,
            )
            for line in out.strip().split("\n"):
                if line.strip():
                    self._log(f"    {line.strip()}")
            self._log("  Done.\n")
        except subprocess.CalledProcessError as e:
            self._log(f"  Failed: {e.output.strip() if e.output else e}")
        except Exception as e:
            self._log(f"  Error: {e}")
        finally:
            self.after(0, self._set_loading, False)

    # ══════════════════════════════════════════════════════════════
    # Logging
    # ══════════════════════════════════════════════════════════════
    def _log(self, text):
        self.after(0, self._log_sync, text)

    def _log_sync(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")


if __name__ == "__main__":
    NetworkDoctor().mainloop()
