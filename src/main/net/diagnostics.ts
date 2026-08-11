import { lookup } from 'node:dns/promises'
import type { DiagnosticsReport, PingResult } from '../../shared/types'
import { gatewayAddress, ipConfiguration, platform } from './capabilities'
import { isIpAddress, run } from './exec'

const BASE_TARGETS: Array<{ label: string; target: string }> = [
  { label: 'Google DNS', target: '8.8.8.8' },
  { label: 'Cloudflare', target: '1.1.1.1' },
  { label: 'google.com', target: 'google.com' },
]

/** Hostnames reach a command line, so anything odd is refused outright. */
function isSafeHost(host: string): boolean {
  return isIpAddress(host) || /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9-]{1,63})*$/.test(host)
}

/**
 * Round-trip time in ms, or null if the host did not answer.
 *
 * The flags differ across platforms in a way that bites: -w on Windows and -W
 * on macOS are milliseconds, while -W on Linux is whole seconds.
 */
export async function ping(host: string): Promise<number | null> {
  if (!isSafeHost(host)) return null

  const cmd =
    platform === 'win32'
      ? `ping -n 1 -w 2000 ${host}`
      : platform === 'darwin'
        ? `ping -c 1 -W 2000 ${host}`
        : `ping -c 1 -W 2 ${host}`

  const { stdout } = await run(cmd, 6000)
  // "time=12ms", "time=12.3 ms" and the localised "durata=12ms" all appear.
  const match = stdout.match(/(?:time|durata|tempo|Zeit)[=<]\s*([\d.]+)\s*ms/i)
  if (match) return Math.round(parseFloat(match[1]))
  // Some builds print "rtt min/avg/max/mdev = 8.1/8.1/8.1/0.0 ms"
  const rtt = stdout.match(/=\s*[\d.]+\/([\d.]+)\//)
  return rtt ? Math.round(parseFloat(rtt[1])) : null
}

export async function dnsResolves(): Promise<boolean> {
  try {
    await lookup('google.com')
    return true
  } catch {
    return false
  }
}

export async function isOnline(): Promise<boolean> {
  const [a, b] = await Promise.all([ping('1.1.1.1'), ping('8.8.8.8')])
  return a !== null || b !== null
}

export async function runDiagnostics(): Promise<DiagnosticsReport> {
  const gateway = await gatewayAddress()
  const targets = gateway ? [{ label: 'Router', target: gateway }, ...BASE_TARGETS] : BASE_TARGETS

  const [pings, ipConfig, dns] = await Promise.all([
    Promise.all(
      targets.map(async ({ label, target }): Promise<PingResult> => {
        const ms = await ping(target)
        return { label, target, ms, ok: ms !== null }
      }),
    ),
    ipConfiguration(),
    dnsResolves(),
  ])

  return {
    online: pings.some((p) => p.ok && p.label !== 'Router'),
    gateway,
    ipConfig,
    pings,
    dnsResolves: dns,
  }
}
