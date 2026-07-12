"""Network Doctor v3 - speedtest-style network utility (Windows)."""
import customtkinter as ctk
import tkinter as tk
from tkinter import messagebox
from pathlib import Path
import subprocess
import threading
import socket
import webbrowser
import json
import base64
import re
import time
import math
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageTk

import atexit
import ctypes
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

try:
    # Windows' default timer tick is ~15.6ms, which caps how often Tkinter's
    # after() can actually fire regardless of the delay requested - it makes
    # animations feel choppy and out of sync on high refresh-rate monitors
    # (90/120/144/240Hz). Dropping the system timer resolution to 1ms lets
    # after() fire close to the delay we ask for, so redraws can keep pace
    # with the display instead of being capped near ~64fps.
    ctypes.windll.winmm.timeBeginPeriod(1)
    atexit.register(lambda: ctypes.windll.winmm.timeEndPeriod(1))
except Exception:
    pass

ctk.set_appearance_mode("dark")

CONFIG_FILE = Path.home() / ".network-doctor.json"
NO_WINDOW = 0x08000000  # hide console flashes from subprocess calls

# ── Palette (speedtest-inspired dark navy + teal) ────────────────
C_BASE   = "#0b1120"
C_CARD   = "#131c31"
C_CARD2  = "#0e1627"
C_BORDER = "#1e293b"
C_BORDHI = "#41699e"
C_HOVER  = "#233047"
C_TEXT   = "#f8fafc"
C_SUB    = "#94a3b8"
C_MUTED  = "#64748b"
C_TEAL   = "#2dd4bf"
C_TEALD  = "#14b8a6"
C_GREEN  = "#4ade80"
C_RED    = "#f87171"
C_AMBER  = "#fbbf24"
C_BLUE   = "#60a5fa"
C_PURPLE = "#a78bfa"
C_DARK   = "#0b1120"

RGB_TEAL  = (45, 212, 191)
RGB_GREEN = (74, 222, 128)

PING_TARGETS_BASE = [("Google DNS", "8.8.8.8"), ("Cloudflare", "1.1.1.1"), ("google.com", "google.com")]
_WIN_NEEDS_ADMIN = {"ip_renew", "winsock", "adapter_restart", "net_reset"}


def _hex2rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _lerp_color(h1, h2, t):
    a, b = _hex2rgb(h1), _hex2rgb(h2)
    return "#%02x%02x%02x" % tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _silent(cmd, timeout=15):
    return subprocess.check_output(cmd, shell=True, stderr=subprocess.STDOUT, timeout=timeout,
                                   text=True, creationflags=NO_WINDOW)


def _detect_router_ip():
    try:
        out = _silent("ipconfig", 5)
        for line in out.split("\n"):
            if "Default Gateway" in line and ":" in line:
                ip = line.split(":")[-1].strip()
                if re.match(r"\d+\.\d+\.\d+\.\d+", ip):
                    return ip
    except Exception:
        pass
    return "192.168.0.1"


def _is_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _load_config():
    try:
        if CONFIG_FILE.exists():
            data = json.loads(CONFIG_FILE.read_text())
            return base64.b64decode(data.get("rp", "")).decode() or ""
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
        ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", f'/c {cmd} & pause', None, 1)
        return ret > 32
    except Exception:
        return False


def _get_active_adapter():
    try:
        out = _silent('powershell -Command "Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' }'
                      ' | Select-Object -First 1 -ExpandProperty Name"', 8)
        return out.strip().split("\n")[0].strip() or None
    except Exception:
        return None


def _pil_font(size):
    for name in ("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


class CircleButton(tk.Canvas):
    """Speedtest-style hero button: rotating comet arc + breathing glow,
    brighter on hover, green ripple on click. All frames pre-rendered
    with PIL at 2x supersampling for antialiasing."""

    N = 108       # rotation frames (one full revolution) - targets 60fps redraw rate
    SS = 2        # supersampling factor

    def __init__(self, master, size=250, command=None, lines=("RESTART", "ROUTER")):
        try:
            self._scale = master.winfo_toplevel()._get_widget_scaling()
        except Exception:
            self._scale = 1.0
        px = int(size * self._scale)
        super().__init__(master, width=px, height=px, bg=C_BASE, highlightthickness=0, cursor="hand2")
        self.command = command
        self._px = px
        self._render(px, lines)
        self._item = self.create_image(px // 2, px // 2, image=self._frames[0])
        self._i = 0
        self._hover = False
        self._last_hover_drawn = False
        self._rippling = False
        self._t0 = time.perf_counter()
        self._period = 1.8  # seconds per full revolution
        self.bind("<Enter>", lambda e: self._set_hover(True))
        self.bind("<Leave>", lambda e: self._set_hover(False))
        self.bind("<Button-1>", self._click)
        self._spin()

    # ── rendering ──
    def _render(self, px, lines):
        from PIL import ImageEnhance
        D = px * self.SS
        c = D / 2
        ring_r = D / 2 - 18 * self.SS
        ring_w = int(2.2 * self._scale * self.SS)
        bg = _hex2rgb(C_BASE)

        def disc_layer(ring_rgb, lift=0):
            img = Image.new("RGBA", (D, D), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            steps = 36
            inner = (20 + lift, 31 + lift, 54 + lift)
            outer = (13 + lift, 21 + lift, 38 + lift)
            for s in range(steps, 0, -1):
                t = s / steps
                col = tuple(int(outer[k] + (inner[k] - outer[k]) * (1 - t)) for k in range(3))
                d.ellipse([c - ring_r * t, c - ring_r * t, c + ring_r * t, c + ring_r * t], fill=col + (255,))
            d.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r],
                      outline=ring_rgb + (255,), width=ring_w)
            r2 = ring_r - 7 * self.SS
            d.ellipse([c - r2, c - r2, c + r2, c + r2], outline=(48, 66, 104, 110),
                      width=max(1, self.SS))
            f = _pil_font(int(D * 0.105))
            dy = D * 0.058
            for i, txt in enumerate(lines):
                y = c + (i - (len(lines) - 1) / 2) * 2.1 * dy
                d.text((c, y), txt, font=f, fill=(248, 250, 252, 255), anchor="mm")
            return img

        # soft glow ring, blurred once, alpha-scaled per frame
        glow = Image.new("RGBA", (D, D), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([c - ring_r, c - ring_r, c + ring_r, c + ring_r],
                   outline=RGB_TEAL + (255,), width=int(8 * self.SS * self._scale))
        glow = glow.filter(ImageFilter.GaussianBlur(12 * self.SS))

        # comet: near-white arc with fading 120° tail + its own glow halo
        comet = Image.new("RGBA", (D, D), (0, 0, 0, 0))
        cd = ImageDraw.Draw(comet)
        box = [c - ring_r, c - ring_r, c + ring_r, c + ring_r]
        tail, segs = 120, 48
        for s in range(segs):
            a1 = -s * tail / segs
            a0 = a1 - tail / segs - 0.5
            alpha = int(255 * (1 - s / segs) ** 1.4)
            cd.arc(box, start=a0, end=a1, fill=(212, 255, 248, alpha),
                   width=int(5.5 * self.SS * self._scale))
        halo = comet.filter(ImageFilter.GaussianBlur(6 * self.SS))
        halo.putalpha(halo.getchannel("A").point(lambda v: int(v * 0.85)))
        halo.alpha_composite(comet.filter(ImageFilter.GaussianBlur(int(1.2 * self.SS))))
        comet = halo

        # dim base ring so the moving comet pops against it
        base = disc_layer((21, 99, 90))

        def flatten(img):
            out = Image.new("RGB", (D, D), bg)
            out.paste(img, (0, 0), img)
            return out.resize((px, px), Image.LANCZOS)

        self._frames = []
        self._hover_frames = []
        for i in range(self.N):
            breath = 0.35 + 0.65 * (math.sin(2 * math.pi * i / self.N) + 1) / 2
            fr = Image.new("RGBA", (D, D), (0, 0, 0, 0))
            g = glow.copy()
            g.putalpha(g.getchannel("A").point(lambda v, s=breath: int(v * s)))
            fr.alpha_composite(g)
            fr.alpha_composite(base)
            # BILINEAR, not BICUBIC: the comet is already Gaussian-blurred so
            # the softer resample is visually identical but ~2x cheaper,
            # letting us pre-render far more frames in the same startup time.
            fr.alpha_composite(comet.rotate(-i * 360 / self.N, resample=Image.BILINEAR))
            self._frames.append(ImageTk.PhotoImage(flatten(fr)))
            # Brighten the RGBA composite itself (still transparent background,
            # alpha untouched by blend-with-black) BEFORE flattening onto bg -
            # brightening the flattened square instead lit up the whole square
            # behind the ring, showing as a visible box on hover.
            hover_fr = ImageEnhance.Brightness(fr).enhance(1.28)
            self._hover_frames.append(ImageTk.PhotoImage(flatten(hover_fr)))

        # ripple: expanding green ring fading out
        self._ripple = []
        bright = disc_layer((94, 234, 212), lift=7)
        for i in range(6):
            t = i / 5
            fr = Image.new("RGBA", (D, D), (0, 0, 0, 0))
            fr.alpha_composite(glow)
            fr.alpha_composite(bright)
            rd = ImageDraw.Draw(fr)
            rr = ring_r + (ring_r * 0.16) * t
            alpha = int(220 * (1 - t))
            rd.ellipse([c - rr, c - rr, c + rr, c + rr],
                       outline=RGB_GREEN + (alpha,), width=int(3.5 * self.SS * self._scale))
            self._ripple.append(ImageTk.PhotoImage(flatten(fr)))

    # ── behaviour ──
    def _set_hover(self, on):
        self._hover = on

    def _click(self, _):
        if self.command:
            self.command()
        self._rippling = True
        self._play_ripple(time.perf_counter())

    def _play_ripple(self, t0, dur=0.22):
        t = (time.perf_counter() - t0) / dur
        if t < 1.0:
            self.itemconfig(self._item, image=self._ripple[int(t * len(self._ripple))])
            self.after(6, self._play_ripple, t0, dur)
        else:
            self._rippling = False

    def _spin(self):
        if not self._rippling:
            # Frame picked from elapsed wall-clock time, not a tick counter -
            # immune to after() jitter/drift, so rotation speed stays constant
            # regardless of the monitor's refresh rate or timer delays.
            elapsed = time.perf_counter() - self._t0
            i = int((elapsed / self._period) * self.N) % self.N
            if i != self._i or self._hover != self._last_hover_drawn:
                self._i = i
                self._last_hover_drawn = self._hover
                frames = self._hover_frames if self._hover else self._frames
                self.itemconfig(self._item, image=frames[i])
        # Poll faster than any frame bucket (period/N = 25ms) so a new frame
        # appears within a few ms of becoming due - keeps up with 120/144/240Hz.
        self.after(4, self._spin)


class NetworkDoctor(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Network Doctor")
        self.configure(fg_color=C_BASE)
        self._saved_password = _load_config()
        self._router_ip = _detect_router_ip()
        self._ping_targets = [("Router", self._router_ip)] + PING_TARGETS_BASE
        self._last_ip_info = ""
        self._toast_job = None
        self._online = None
        self._pulse_t0 = time.perf_counter()
        self._speed_testing = False

        self.geometry("600x730")
        self.minsize(560, 680)
        self.attributes("-alpha", 0.0)
        self._build_ui()
        self._fade_in()
        self.after(400, self._auto_check)
        self.after(900, self._pulse_status)

    def _fade_in(self, t0=None):
        if t0 is None:
            t0 = time.perf_counter()
        t = min(1.0, (time.perf_counter() - t0) / 0.3)
        self.attributes("-alpha", t)
        if t < 1.0:
            self.after(6, self._fade_in, t0)

    # ══════════════════════ UI ══════════════════════
    def _build_ui(self):
        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=24, pady=(18, 4))
        ctk.CTkLabel(head, text="NETWORK DOCTOR", font=ctk.CTkFont("Segoe UI", 17, "bold"),
                     text_color=C_TEXT).pack(side="left")
        right = ctk.CTkFrame(head, fg_color="transparent")
        right.pack(side="right")
        self.status_lbl = ctk.CTkLabel(right, text="●  se verifică...", font=ctk.CTkFont("Segoe UI", 12, "bold"),
                                       text_color=C_MUTED)
        self.status_lbl.pack(anchor="e")
        ctk.CTkLabel(right, text=f"gateway {self._router_ip}", font=ctk.CTkFont("Segoe UI", 10),
                     text_color=C_MUTED).pack(anchor="e")

        self.tabs = ctk.CTkTabview(
            self, fg_color="transparent",
            segmented_button_fg_color=C_CARD, segmented_button_selected_color=C_TEALD,
            segmented_button_selected_hover_color=C_TEAL, segmented_button_unselected_color=C_CARD,
            segmented_button_unselected_hover_color=C_HOVER,
            text_color=C_TEXT, corner_radius=10,
        )
        self.tabs.pack(fill="both", expand=True, padx=16, pady=(0, 10))
        self.tabs._segmented_button.configure(font=ctk.CTkFont("Segoe UI", 13, "bold"), height=36)
        for name in ("Acasă", "Reparații", "Diagnostic"):
            self.tabs.add(name)
        self._build_home(self.tabs.tab("Acasă"))
        self._build_fixes(self.tabs.tab("Reparații"))
        self._build_diag(self.tabs.tab("Diagnostic"))

    def _card(self, parent, **pack):
        f = ctk.CTkFrame(parent, fg_color=C_CARD, corner_radius=14, border_width=1, border_color=C_BORDER)
        f.pack(fill="x", **pack)
        self._hoverize(f)
        return f

    def _hoverize(self, widget, hi=C_BORDHI):
        """Animated border highlight on hover, paced by elapsed time
        (not tick count) so it stays smooth at any monitor refresh rate."""
        def go(target):
            start = widget.cget("border_color")
            t0 = time.perf_counter()
            dur = 0.14

            def step():
                t = min(1.0, (time.perf_counter() - t0) / dur)
                try:
                    widget.configure(border_color=_lerp_color(start, target, t))
                except Exception:
                    return
                if t < 1.0:
                    widget.after(6, step)
            step()
        widget.bind("<Enter>", lambda e: go(hi), add="+")
        widget.bind("<Leave>", lambda e: go(C_BORDER), add="+")

    def _toast(self, text, color=C_GREEN):
        if self._toast_job:
            self.after_cancel(self._toast_job)
            self._toast_job = None
        lbl = self.toast_lbl

        def fade(t0_from, t0_to, dur, on_text=None):
            t0 = time.perf_counter()

            def step():
                t = min(1.0, (time.perf_counter() - t0) / dur)
                kw = {"text_color": _lerp_color(t0_from, t0_to, t)}
                if on_text:
                    kw["text"] = on_text
                lbl.configure(**kw)
                if t < 1.0:
                    lbl.after(6, step)
            step()

        fade(C_BASE, color, 0.24, on_text=text)

        def fade_out():
            fade(color, C_BASE, 0.4)
            lbl.after(420, lambda: lbl.configure(text=""))
        self._toast_job = self.after(3200, fade_out)

    def _count_to(self, key, value, suffix_decimals=0):
        """Ease-out count-up animation for stat tiles."""
        lbl = self.stat_vals[key]
        try:
            end = float(value)
        except (TypeError, ValueError):
            lbl.configure(text=value if value else "✕")
            return
        t0 = time.perf_counter()

        def step():
            t = min(1.0, (time.perf_counter() - t0) / 0.8)
            e = 1 - (1 - t) ** 3
            lbl.configure(text=f"{end * e:.{suffix_decimals}f}")
            if t < 1.0:
                lbl.after(6, step)
        step()

    # ── Tab: Acasă ──
    def _build_home(self, tab):
        tab.configure(fg_color="transparent")

        hero = ctk.CTkFrame(tab, fg_color="transparent")
        hero.pack(expand=True, fill="both")
        inner = ctk.CTkFrame(hero, fg_color="transparent")
        inner.place(relx=0.5, rely=0.5, anchor="center")
        CircleButton(inner, command=self._restart_router_flow).pack()
        ctk.CTkLabel(inner, text="un click - copiază parola și deschide pagina routerului",
                     font=ctk.CTkFont("Segoe UI", 11), text_color=C_MUTED).pack(pady=(6, 0))
        self.toast_lbl = ctk.CTkLabel(inner, text="", font=ctk.CTkFont("Segoe UI", 12, "bold"),
                                      text_color=C_GREEN)
        self.toast_lbl.pack(pady=(2, 0))

        # Stat tiles
        stats = ctk.CTkFrame(tab, fg_color="transparent")
        stats.pack(fill="x", padx=8, pady=(4, 10))
        for i in range(3):
            stats.grid_columnconfigure(i, weight=1, uniform="s")
        self.stat_vals = {}
        self.stat_tiles = {}
        tiles = [("PING ROUTER", "router", C_TEAL, "ms"), ("PING INTERNET", "inet", C_BLUE, "ms"),
                 ("DOWNLOAD", "down", C_PURPLE, "Mbps")]
        for i, (title, key, color, unit) in enumerate(tiles):
            t = ctk.CTkFrame(stats, fg_color=C_CARD, corner_radius=12, border_width=1, border_color=C_BORDER)
            t.grid(row=0, column=i, sticky="nsew", padx=4)
            self._hoverize(t)
            ctk.CTkLabel(t, text=title, font=ctk.CTkFont("Segoe UI", 10, "bold"),
                         text_color=C_MUTED).pack(pady=(10, 0))
            v = ctk.CTkLabel(t, text="-", font=ctk.CTkFont("Segoe UI", 22, "bold"), text_color=color)
            v.pack()
            ctk.CTkLabel(t, text=unit, font=ctk.CTkFont("Segoe UI", 9), text_color=C_MUTED).pack(pady=(0, 8))
            self.stat_vals[key] = v
            self.stat_tiles[key] = t

        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.pack(fill="x", padx=8, pady=(0, 10))
        row.grid_columnconfigure((0, 1), weight=1)
        self.btn_speed = ctk.CTkButton(row, text="Test viteză", command=self._run_speed_test,
                                       height=40, corner_radius=10, font=ctk.CTkFont("Segoe UI", 13, "bold"),
                                       fg_color=C_TEALD, hover_color=C_TEAL, text_color=C_DARK)
        self.btn_speed.grid(row=0, column=0, sticky="ew", padx=(0, 5))
        ctk.CTkButton(row, text="Deschide routerul", command=self._open_router,
                      height=40, corner_radius=10, font=ctk.CTkFont("Segoe UI", 13, "bold"),
                      fg_color=C_CARD, hover_color=C_HOVER, text_color=C_TEXT,
                      border_width=1, border_color=C_BORDER).grid(row=0, column=1, sticky="ew", padx=(5, 0))

        # Password card
        pw = self._card(tab, padx=8, pady=(0, 4))
        top = ctk.CTkFrame(pw, fg_color="transparent")
        top.pack(fill="x", padx=14, pady=(12, 4))
        ctk.CTkLabel(top, text="Parolă router", font=ctk.CTkFont("Segoe UI", 12, "bold"),
                     text_color=C_SUB).pack(side="left")
        self.pw_status = ctk.CTkLabel(top, text="✓ salvată" if self._saved_password else "",
                                      font=ctk.CTkFont("Segoe UI", 11), text_color=C_GREEN)
        self.pw_status.pack(side="right")
        ctrl = ctk.CTkFrame(pw, fg_color="transparent")
        ctrl.pack(fill="x", padx=14, pady=(0, 12))
        self.pw_var = ctk.StringVar(value=self._saved_password)
        self.pw_entry = ctk.CTkEntry(ctrl, textvariable=self.pw_var, show="•", height=36, corner_radius=8,
                                     fg_color=C_CARD2, border_color=C_BORDER, text_color=C_TEXT)
        self.pw_entry.pack(side="left", fill="x", expand=True, padx=(0, 8))
        ctk.CTkButton(ctrl, text="👁", command=self._toggle_pw_vis, width=36, height=36, corner_radius=8,
                      font=ctk.CTkFont(size=13), fg_color=C_CARD2, hover_color=C_HOVER,
                      text_color=C_SUB).pack(side="left", padx=(0, 6))
        ctk.CTkButton(ctrl, text="Copiază", command=self._copy_password, width=70, height=36, corner_radius=8,
                      font=ctk.CTkFont("Segoe UI", 11, "bold"), fg_color=C_CARD2, hover_color=C_HOVER,
                      text_color=C_TEXT).pack(side="left", padx=(0, 6))
        ctk.CTkButton(ctrl, text="Salvează", command=self._save_password_action, width=76, height=36,
                      corner_radius=8, font=ctk.CTkFont("Segoe UI", 11, "bold"),
                      fg_color=C_TEALD, hover_color=C_TEAL, text_color=C_DARK).pack(side="left")

    # ── Tab: Reparații ──
    def _build_fixes(self, tab):
        tab.configure(fg_color="transparent")
        scroll = ctk.CTkScrollableFrame(tab, fg_color="transparent",
                                        scrollbar_button_color=C_BORDER, scrollbar_button_hover_color=C_HOVER)
        scroll.pack(fill="both", expand=True)

        fixes = [
            ("Flush DNS", "dns_flush", "Curăță cache-ul DNS - repară „site not found”", C_BLUE),
            ("Renew IP", "ip_renew", "Cere IP nou de la router - repară „no valid IP”", C_BLUE),
            ("Reset Winsock", "winsock", "Reconstruiește socket-urile de rețea", C_AMBER),
            ("Restart adaptor", "adapter_restart", "Oprește/pornește placa de rețea", C_AMBER),
        ]
        grid = ctk.CTkFrame(scroll, fg_color="transparent")
        grid.pack(fill="x", pady=(8, 4))
        grid.grid_columnconfigure((0, 1), weight=1, uniform="f")
        for i, (label, key, desc, color) in enumerate(fixes):
            card = ctk.CTkFrame(grid, fg_color=C_CARD, corner_radius=12, border_width=1, border_color=C_BORDER)
            card.grid(row=i // 2, column=i % 2, sticky="nsew", padx=4, pady=4)
            self._hoverize(card)
            ctk.CTkButton(card, text=label, command=lambda k=key: self._run_fix(k),
                          height=36, corner_radius=8, font=ctk.CTkFont("Segoe UI", 12, "bold"),
                          fg_color=color, hover_color=C_TEAL if color == C_BLUE else "#f5a623",
                          text_color=C_DARK).pack(fill="x", padx=10, pady=(10, 4))
            ctk.CTkLabel(card, text=desc, font=ctk.CTkFont("Segoe UI", 10), text_color=C_MUTED,
                         wraplength=220, justify="left").pack(anchor="w", padx=12, pady=(0, 10))

        full = self._card(scroll, pady=(6, 10))
        ctk.CTkButton(full, text="⚠  RESET COMPLET - toate reparațiile deodată",
                      command=lambda: self._run_fix("net_reset"),
                      height=42, corner_radius=8, font=ctk.CTkFont("Segoe UI", 12, "bold"),
                      fg_color=C_RED, hover_color="#ef4444", text_color=C_DARK).pack(fill="x", padx=12, pady=10)
        ctk.CTkLabel(full, text="Ultima soluție înainte de restart la PC. Cere drepturi de administrator.",
                     font=ctk.CTkFont("Segoe UI", 10), text_color=C_MUTED).pack(padx=12, pady=(0, 10))

        ctk.CTkLabel(scroll, text="OPTIMIZĂRI", font=ctk.CTkFont("Segoe UI", 11, "bold"),
                     text_color=C_SUB).pack(anchor="w", padx=4, pady=(8, 2))
        opts = [
            ("DNS rapid (1.1.1.1 + 8.8.8.8)", self._set_fast_dns,
             "Cea mai mare îmbunătățire de viteză, de obicei. Cere admin."),
            ("Oprește sleep-ul adaptorului", self._prevent_wifi_sleep,
             "Windows nu mai oprește placa de rețea - repară deconectările random. Cere admin."),
        ]
        for label, cmd, desc in opts:
            card = self._card(scroll, pady=(0, 8))
            ctk.CTkButton(card, text=label, command=cmd, height=38, corner_radius=8,
                          font=ctk.CTkFont("Segoe UI", 12, "bold"),
                          fg_color=C_TEALD, hover_color=C_TEAL, text_color=C_DARK).pack(fill="x", padx=12, pady=(12, 4))
            ctk.CTkLabel(card, text=desc, font=ctk.CTkFont("Segoe UI", 10),
                         text_color=C_MUTED).pack(anchor="w", padx=14, pady=(0, 12))

    # ── Tab: Diagnostic ──
    def _build_diag(self, tab):
        tab.configure(fg_color="transparent")

        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.pack(fill="x", pady=(8, 8))
        self.btn_diag = ctk.CTkButton(row, text="▶  Rulează toate testele", command=self._run_all_diags,
                                      height=40, corner_radius=10, font=ctk.CTkFont("Segoe UI", 13, "bold"),
                                      fg_color=C_TEALD, hover_color=C_TEAL, text_color=C_DARK)
        self.btn_diag.pack(side="left")
        self.progress = ctk.CTkProgressBar(row, width=150, height=6, progress_color=C_TEAL,
                                           fg_color=C_CARD, corner_radius=3)
        self.progress.set(0)  # shown only while running

        ping_grid = ctk.CTkFrame(tab, fg_color="transparent")
        ping_grid.pack(fill="x", pady=(0, 8))
        ping_grid.grid_columnconfigure((0, 1), weight=1, uniform="p")
        self.ping_labels = {}
        for i, (label, target) in enumerate(self._ping_targets):
            card = ctk.CTkFrame(ping_grid, fg_color=C_CARD, corner_radius=10, border_width=1, border_color=C_BORDER)
            card.grid(row=i // 2, column=i % 2, sticky="nsew", padx=4, pady=3)
            self._hoverize(card)
            inner = ctk.CTkFrame(card, fg_color="transparent")
            inner.pack(fill="x", padx=12, pady=8)
            ctk.CTkLabel(inner, text=f"{label}  ·  {target}", font=ctk.CTkFont("Segoe UI", 11),
                         text_color=C_SUB).pack(side="left")
            lbl = ctk.CTkLabel(inner, text="-", font=ctk.CTkFont("Segoe UI", 12, "bold"), text_color=C_MUTED)
            lbl.pack(side="right")
            self.ping_labels[label] = lbl

        ip_card = self._card(tab, pady=(0, 8))
        bar = ctk.CTkFrame(ip_card, fg_color="transparent")
        bar.pack(fill="x", padx=12, pady=(8, 0))
        ctk.CTkLabel(bar, text="Configurație IP", font=ctk.CTkFont("Segoe UI", 11, "bold"),
                     text_color=C_SUB).pack(side="left")
        ctk.CTkButton(bar, text="Copiază", command=self._copy_ip_info, width=60, height=24, corner_radius=6,
                      font=ctk.CTkFont("Segoe UI", 10), fg_color=C_CARD2, hover_color=C_HOVER,
                      text_color=C_SUB).pack(side="right")
        self.info_label = ctk.CTkLabel(ip_card, text="Rulează testele ca să vezi configurația",
                                       font=ctk.CTkFont("Consolas", 10), text_color=C_MUTED,
                                       anchor="w", justify="left")
        self.info_label.pack(anchor="w", padx=12, pady=(4, 10))

        self.log = ctk.CTkTextbox(tab, font=("Consolas", 11), fg_color=C_CARD2, text_color=C_SUB,
                                  corner_radius=10, border_width=1, border_color=C_BORDER)
        self.log.pack(fill="both", expand=True, pady=(0, 4))
        self.log.configure(state="disabled")

    # ══════════════════════ Actions ══════════════════════
    def _restart_router_flow(self):
        pw = self.pw_var.get().strip()
        if pw:
            self.clipboard_clear()
            self.clipboard_append(pw)
            self._toast("Parola copiată - lipește-o în pagina routerului (Ctrl+V)")
        else:
            self._toast("Nicio parolă salvată - completeaz-o mai jos", C_AMBER)
        webbrowser.open(f"http://{self._router_ip}")
        self._log(f"[Router] Deschis http://{self._router_ip} (parola {'copiată' if pw else 'lipsă'})")

    def _open_router(self):
        self._log(f"[Router] Deschis http://{self._router_ip}")
        webbrowser.open(f"http://{self._router_ip}")

    def _toggle_pw_vis(self):
        self.pw_entry.configure(show="" if self.pw_entry.cget("show") else "•")

    def _copy_password(self):
        pw = self.pw_var.get().strip()
        if pw:
            self.clipboard_clear()
            self.clipboard_append(pw)
            self._toast("Parola copiată în clipboard")
        else:
            self._toast("Nicio parolă - scrie-o întâi", C_AMBER)

    def _save_password_action(self):
        pw = self.pw_var.get().strip()
        _save_config(pw)
        self._saved_password = pw
        self.pw_status.configure(text="✓ salvată" if pw else "ștearsă",
                                 text_color=C_GREEN if pw else C_RED)
        self._toast("Parola salvată" if pw else "Parola ștearsă", C_GREEN if pw else C_AMBER)

    def _set_fast_dns(self):
        adapter = _get_active_adapter()
        if not adapter:
            messagebox.showwarning("Fără adaptor", "Nu am găsit un adaptor de rețea activ.")
            return
        if not messagebox.askyesno("DNS rapid",
                                   f"Setez adaptorul „{adapter}” pe:\n\n  1.1.1.1 (Cloudflare)\n  8.8.8.8 (Google)\n\n"
                                   "Va apărea fereastra UAC. Continui?"):
            return
        cmd = (f'netsh interface ip set dns name="{adapter}" source=static addr=1.1.1.1'
               f' && netsh interface ip add dns name="{adapter}" addr=8.8.8.8 index=2')
        ok = _run_as_admin(cmd)
        self._log("[OPTIMIZE] DNS setat pe 1.1.1.1 + 8.8.8.8" if ok else "[OPTIMIZE] Anulat sau eșuat.")
        if ok:
            self._toast("DNS rapid setat")

    def _prevent_wifi_sleep(self):
        adapter = _get_active_adapter()
        if not adapter:
            messagebox.showwarning("Fără adaptor", "Nu am găsit un adaptor de rețea activ.")
            return
        if not messagebox.askyesno("Oprire sleep adaptor",
                                   f"Windows nu va mai opri „{adapter}” pentru economie de energie.\n\n"
                                   "Va apărea fereastra UAC. Continui?"):
            return
        cmd = (f'powercfg /setdcvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'
               f' 12bbebe6-58d6-4636-95bb-3217ef867c1a 0'
               f' && powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1'
               f' 12bbebe6-58d6-4636-95bb-3217ef867c1a 0'
               f' && powershell -Command "Get-NetAdapter -Name \'{adapter}\''
               f' | Disable-NetAdapterPowerManagement -Confirm:$false"')
        ok = _run_as_admin(cmd)
        self._log(f"[OPTIMIZE] Sleep oprit pentru „{adapter}”" if ok else "[OPTIMIZE] Anulat sau eșuat.")
        if ok:
            self._toast("Sleep-ul adaptorului oprit")

    def _run_fix(self, fix_type):
        commands = {
            "dns_flush":       ("ipconfig /flushdns", "Curăț cache-ul DNS"),
            "ip_renew":        ("ipconfig /release && ipconfig /renew", "Reînnoiesc IP-ul"),
            "winsock":         ("netsh winsock reset", "Resetez Winsock"),
            "adapter_restart": ('powershell -Command "Get-NetAdapter | Where-Object {$_.Status -eq \'Up\'}'
                                ' | Select-Object -First 1 | Restart-NetAdapter"', "Repornesc adaptorul"),
            "net_reset":       ("netsh int ip reset && netsh winsock reset && ipconfig /flushdns",
                                "Reset complet de rețea"),
        }
        cmd, msg = commands.get(fix_type, ("", ""))
        if not cmd:
            return
        self._log(f"\n[FIX] {msg}")
        self._set_loading(True)
        if fix_type in _WIN_NEEDS_ADMIN and not _is_admin():
            self._log("  Cere admin - deschid fereastra UAC...")
            ok = _run_as_admin(cmd)
            self._log("  Gata (vezi fereastra elevată).\n" if ok else "  Anulat sau eșuat.\n")
            self._toast(msg + " - pornit" if ok else "Anulat", C_GREEN if ok else C_AMBER)
            self._set_loading(False)
            return
        threading.Thread(target=self._exec, args=(cmd, msg), daemon=True).start()

    # ══════════════════════ Diagnostics ══════════════════════
    def _set_loading(self, active):
        if active:
            self.progress.pack(side="right", padx=6)
            self.progress.start()
        else:
            self.progress.stop()
            self.progress.set(0)
            self.progress.pack_forget()

    def _auto_check(self):
        threading.Thread(target=self._auto_worker, daemon=True).start()

    def _auto_worker(self):
        online = self._check_internet()
        self.after(0, self._set_online, online)
        r = self._ping(self._router_ip)
        i = self._ping("8.8.8.8")
        self.after(0, lambda: self._count_to("router", r))
        self.after(0, lambda: self._count_to("inet", i))

    def _set_online(self, online):
        self._online = online

    def _pulse_status(self):
        """Gently pulsing status indicator, paced by elapsed time so the
        breathing speed is identical on any monitor refresh rate."""
        if self._online is None:
            self.status_lbl.configure(text="●  se verifică...", text_color=C_MUTED)
        else:
            elapsed = time.perf_counter() - self._pulse_t0
            t = (math.sin(elapsed * 1.8) + 1) / 2
            if self._online:
                self.status_lbl.configure(text="●  Conectat",
                                          text_color=_lerp_color("#15803d", "#86efac", t))
            else:
                self.status_lbl.configure(text="●  Fără internet",
                                          text_color=_lerp_color("#991b1b", "#fca5a5", t))
        self.after(20, self._pulse_status)

    def _run_all_diags(self):
        self._log("\n" + "─" * 40)
        self._log("  Diagnostic complet...")
        self._set_loading(True)
        threading.Thread(target=self._diag_worker, daemon=True).start()

    def _diag_worker(self):
        online = self._check_internet()
        self.after(0, self._set_online, online)
        try:
            out = _silent("ipconfig")
            lines = [l.strip() for l in out.split("\n")
                     if any(k in l for k in ["IPv4", "Default Gateway", "DNS Server", "Subnet Mask"])]
            info = "\n".join(lines) or "Nicio informație IP găsită"
        except Exception as e:
            info = f"Eroare la citirea configurației: {e}"
        self._last_ip_info = info
        self.after(0, lambda: self.info_label.configure(text=info, text_color=C_SUB))

        for label, target in self._ping_targets:
            ms = self._ping(target)
            ok = ms is not None
            text = f"{ms} ms" if ok else "TIMEOUT"
            self.after(0, lambda l=label, t=text, c=C_GREEN if ok else C_RED:
                       self.ping_labels[l].configure(text=t, text_color=c))
            self._log(f"  Ping {label:<14} {text}")

        try:
            socket.gethostbyname("google.com")
            self._log("  Rezoluție DNS       OK")
        except Exception:
            self._log("  Rezoluție DNS       EȘUAT")
        self._log("─" * 40 + "\n")
        self.after(0, self._set_loading, False)

    def _copy_ip_info(self):
        if self._last_ip_info:
            self.clipboard_clear()
            self.clipboard_append(self._last_ip_info)
            self._log("[Diag] Configurație IP copiată")

    def _run_speed_test(self):
        if self._speed_testing:
            return
        self._speed_testing = True
        self.btn_speed.configure(state="disabled")
        self._log("\n[SPEED] Test de download...")
        self._pulse_tile("down")
        self._speed_dots(0)
        threading.Thread(target=self._speed_worker, daemon=True).start()

    def _speed_dots(self, step):
        if not self._speed_testing:
            return
        self.btn_speed.configure(text="Se testează" + "." * (step % 4))
        self.after(320, self._speed_dots, step + 1)

    def _pulse_tile(self, key, t0=None):
        """Pulse the tile border while its measurement runs, paced by
        elapsed time so the pulse rate is the same on any monitor."""
        if not self._speed_testing:
            self.stat_tiles[key].configure(border_color=C_BORDER)
            return
        if t0 is None:
            t0 = time.perf_counter()
        elapsed = time.perf_counter() - t0
        t = (math.sin(elapsed * 5.6) + 1) / 2
        self.stat_tiles[key].configure(border_color=_lerp_color(C_BORDER, C_PURPLE, t))
        self.after(16, self._pulse_tile, key, t0)

    def _speed_worker(self):
        url = "https://speed.cloudflare.com/__down?bytes=25000000"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "network-doctor/3.0"})
            t0 = time.perf_counter()
            total = 0
            with urllib.request.urlopen(req, timeout=30) as r:
                while True:
                    chunk = r.read(262144)
                    if not chunk:
                        break
                    total += len(chunk)
                    elapsed = time.perf_counter() - t0
                    if elapsed > 0.3:
                        mbps = (total * 8 / 1_000_000) / elapsed
                        self.after(0, lambda m=mbps: self.stat_vals["down"].configure(text=f"{m:.0f}"))
            elapsed = time.perf_counter() - t0
            mbps = (total * 8 / 1_000_000) / elapsed
            self.after(0, lambda: self.stat_vals["down"].configure(text=f"{mbps:.1f}"))
            self._log(f"[SPEED] {mbps:.1f} Mbps  ({total / 1_000_000:.0f} MB în {elapsed:.1f}s)")
        except Exception as e:
            self.after(0, lambda: self.stat_vals["down"].configure(text="✕"))
            self._log(f"[SPEED] Eșuat: {e}")
        finally:
            self._speed_testing = False
            self.after(0, lambda: self.btn_speed.configure(state="normal", text="Test viteză"))

    # ══════════════════════ Network helpers ══════════════════════
    def _check_internet(self):
        try:
            socket.create_connection(("8.8.8.8", 53), timeout=2)
            return True
        except Exception:
            return False

    def _ping(self, target):
        try:
            out = _silent(f"ping -n 1 -w 2000 {target}", 4)
            for line in out.split("\n"):
                low = line.lower()
                if "time=" in low:
                    return low.split("time=")[1].split("ms")[0].strip()
                if "time<" in low:
                    return "<1"
        except Exception:
            pass
        return None

    def _exec(self, cmd, msg=""):
        try:
            out = _silent(cmd, 30)
            for line in out.strip().split("\n"):
                if line.strip():
                    self._log(f"    {line.strip()}")
            self._log("  Gata.\n")
            self.after(0, lambda: self._toast((msg or "Comanda") + " - gata"))
        except subprocess.CalledProcessError as e:
            self._log(f"  Eșuat: {e.output.strip() if e.output else e}")
            self.after(0, lambda: self._toast("A eșuat - vezi Diagnostic", C_RED))
        except Exception as e:
            self._log(f"  Eroare: {e}")
        finally:
            self.after(0, self._set_loading, False)

    def _log(self, text):
        self.after(0, self._log_sync, text)

    def _log_sync(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")


if __name__ == "__main__":
    NetworkDoctor().mainloop()
