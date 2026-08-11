import { isIpAddress, isSafeInterfaceName, run, shellQuote } from './exec'

export type Platform = 'win32' | 'darwin' | 'linux'

export const platform: Platform =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'

/**
 * A repair action, defined once per platform it exists on.
 *
 * Some of these are Windows concepts with no counterpart elsewhere - Winsock
 * is the Windows sockets layer, and there is nothing on macOS or Linux to
 * reset. Those entries carry `unsupported` text instead of a command so the UI
 * can explain the gap rather than show a button that does nothing.
 */
export interface ToolSpec {
  id: string
  label: string
  /** What the user is told is happening while it runs. */
  running: string
  /** Confirm before running - these interrupt connectivity or change config. */
  confirm?: boolean
  perPlatform: Record<
    Platform,
    | { elevated: boolean; build: () => string | Promise<string> }
    | { unsupported: string }
  >
}

/** Interface carrying the default route - the one worth acting on. */
export async function primaryInterface(): Promise<string | null> {
  const cmd: Record<Platform, string> = {
    win32:
      'powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' } | Select-Object -First 1 -ExpandProperty Name"',
    darwin: "route -n get default 2>/dev/null | awk '/interface:/{print $2}'",
    linux: "ip route show default 2>/dev/null | awk '/default/{print $5; exit}'",
  }
  const { stdout } = await run(cmd[platform], 8000)
  const name = stdout.trim().split('\n')[0]?.trim() ?? ''
  return name && isSafeInterfaceName(name) ? name : null
}

/** Default gateway address - the router the hero button opens. */
export async function gatewayAddress(): Promise<string | null> {
  const cmd: Record<Platform, string> = {
    win32:
      'powershell -NoProfile -Command "(Get-NetRoute -DestinationPrefix \'0.0.0.0/0\' | Sort-Object RouteMetric | Select-Object -First 1).NextHop"',
    darwin: "route -n get default 2>/dev/null | awk '/gateway:/{print $2}'",
    linux: "ip route show default 2>/dev/null | awk '/default/{print $3; exit}'",
  }
  const { stdout } = await run(cmd[platform], 8000)
  const ip = stdout.trim().split('\n')[0]?.trim() ?? ''
  return isIpAddress(ip) ? ip : null
}

/** Human-readable IP configuration, for the Diagnostics panel. */
export async function ipConfiguration(): Promise<string> {
  const cmd: Record<Platform, string> = {
    win32: 'ipconfig',
    darwin: 'ifconfig',
    linux: 'ip addr',
  }
  const { stdout, stderr } = await run(cmd[platform], 10_000)
  return (stdout || stderr).trim()
}

const needsInterface = async (
  make: (iface: string) => string,
): Promise<string> => {
  const iface = await primaryInterface()
  if (!iface) throw new Error('No active network interface found')
  return make(iface)
}

export const TOOLS: ToolSpec[] = [
  {
    id: 'dns_flush',
    label: 'Golește cache DNS',
    running: 'Curăț cache-ul DNS',
    perPlatform: {
      win32: { elevated: false, build: () => 'ipconfig /flushdns' },
      // Flushing the cache is only half of it on macOS - mDNSResponder holds
      // its own, so it has to be signalled too.
      darwin: {
        elevated: true,
        build: () => 'dscacheutil -flushcache; killall -HUP mDNSResponder',
      },
      linux: { elevated: false, build: () => 'resolvectl flush-caches' },
    },
  },
  {
    id: 'ip_renew',
    label: 'Reînnoiește IP',
    running: 'Reînnoiesc adresa IP',
    confirm: true,
    perPlatform: {
      win32: { elevated: true, build: () => 'ipconfig /release && ipconfig /renew' },
      darwin: {
        elevated: true,
        build: () => needsInterface((i) => `ipconfig set ${shellQuote(i)} DHCP`),
      },
      linux: {
        elevated: true,
        build: () =>
          needsInterface(
            (i) => `dhclient -r ${shellQuote(i)} && dhclient ${shellQuote(i)}`,
          ),
      },
    },
  },
  {
    id: 'adapter_restart',
    label: 'Repornește adaptorul',
    running: 'Repornesc adaptorul de rețea',
    confirm: true,
    perPlatform: {
      win32: {
        elevated: true,
        build: () =>
          'powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' } | Restart-NetAdapter"',
      },
      darwin: {
        elevated: true,
        build: () =>
          needsInterface((i) => `ifconfig ${shellQuote(i)} down && ifconfig ${shellQuote(i)} up`),
      },
      linux: {
        elevated: true,
        build: () =>
          needsInterface(
            (i) => `ip link set dev ${shellQuote(i)} down && ip link set dev ${shellQuote(i)} up`,
          ),
      },
    },
  },
  {
    id: 'set_dns',
    label: 'DNS pe 1.1.1.1',
    running: 'Setez DNS-ul pe Cloudflare și Google',
    confirm: true,
    perPlatform: {
      win32: {
        elevated: true,
        build: () =>
          needsInterface(
            (i) =>
              `netsh interface ip set dns name="${i}" source=static addr=1.1.1.1 && ` +
              `netsh interface ip add dns name="${i}" addr=8.8.8.8 index=2`,
          ),
      },
      darwin: {
        elevated: true,
        build: () =>
          needsInterface((i) => `networksetup -setdnsservers ${shellQuote(i)} 1.1.1.1 8.8.8.8`),
      },
      linux: {
        elevated: true,
        build: () =>
          needsInterface(
            (i) =>
              `resolvectl dns ${shellQuote(i)} 1.1.1.1 8.8.8.8 || ` +
              `nmcli device modify ${shellQuote(i)} ipv4.dns "1.1.1.1,8.8.8.8"`,
          ),
      },
    },
  },
  {
    id: 'winsock',
    label: 'Resetează Winsock',
    running: 'Resetez catalogul Winsock',
    confirm: true,
    perPlatform: {
      win32: { elevated: true, build: () => 'netsh winsock reset' },
      darwin: {
        unsupported:
          'Winsock este stratul de sockets din Windows. macOS nu are un echivalent - repornirea adaptorului acoperă aceleași simptome.',
      },
      linux: {
        unsupported:
          'Winsock este stratul de sockets din Windows. Linux nu are un echivalent - repornirea adaptorului acoperă aceleași simptome.',
      },
    },
  },
  {
    id: 'net_reset',
    label: 'Resetare completă rețea',
    running: 'Resetez stiva TCP/IP',
    confirm: true,
    perPlatform: {
      win32: {
        elevated: true,
        build: () => 'netsh int ip reset && netsh winsock reset && ipconfig /flushdns',
      },
      darwin: {
        unsupported:
          'Stiva TCP/IP nu se resetează separat pe macOS. Cel mai apropiat pas este repornirea serviciului de rețea.',
      },
      linux: {
        unsupported:
          'Stiva TCP/IP nu se resetează separat pe Linux. Cel mai apropiat pas este repornirea NetworkManager.',
      },
    },
  },
  {
    id: 'network_restart',
    label: 'Repornește serviciul de rețea',
    running: 'Repornesc serviciul de rețea',
    confirm: true,
    perPlatform: {
      // The Windows equivalent is covered by adapter_restart and net_reset;
      // offering a third near-duplicate would just be noise.
      win32: {
        unsupported:
          'Pe Windows echivalentul este „Repornește adaptorul" sau „Resetare completă rețea".',
      },
      darwin: {
        elevated: true,
        build: () =>
          needsInterface((i) => `ifconfig ${shellQuote(i)} down && ifconfig ${shellQuote(i)} up`),
      },
      linux: { elevated: true, build: () => 'systemctl restart NetworkManager' },
    },
  },
]

export interface ToolView {
  id: string
  label: string
  available: boolean
  reason?: string
  elevated: boolean
  confirm: boolean
}

/** What the current platform can actually offer, for the Tools screen. */
export function toolsForThisPlatform(): ToolView[] {
  return TOOLS.map((t) => {
    const entry = t.perPlatform[platform]
    const available = !('unsupported' in entry)
    return {
      id: t.id,
      label: t.label,
      available,
      reason: available ? undefined : entry.unsupported,
      elevated: available ? entry.elevated : false,
      confirm: Boolean(t.confirm),
    }
  })
}
