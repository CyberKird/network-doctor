import { lookup } from 'node:dns/promises'
import type { DiagnosticsReport, PingResult, QuickReport } from '../../shared/types'
import { defaultRoute, gatewayAddress, ipConfiguration, platform } from './capabilities'
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

const REPLY = /(?:time|durata|tempo|Zeit)([=<])\s*([\d.]+)\s*ms/gi

export interface PingStats {
  avgMs: number | null
  lossPct: number
  jitterMs: number
}

/**
 * Round-trip times from several probes. The summary lines that report loss are
 * localised ("Lost", "pierdute", "perdidos"), so loss is counted from the
 * per-reply lines instead - a probe with no reply line is a lost probe.
 */
export function summarisePings(output: string, count: number): PingStats {
  const times = [...output.matchAll(REPLY)].map((m) =>
    m[1] === '<' ? Math.min(1, parseFloat(m[2])) : parseFloat(m[2]),
  )
  if (times.length === 0) return { avgMs: null, lossPct: 100, jitterMs: 0 }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const jitter =
    times.length > 1
      ? times.slice(1).reduce((sum, t, i) => sum + Math.abs(t - times[i]), 0) / (times.length - 1)
      : 0
  return {
    avgMs: Math.round(avg),
    lossPct: Math.round(Math.max(0, (count - times.length) / count) * 100),
    jitterMs: Math.round(jitter * 10) / 10,
  }
}

/** Several probes to one host, for loss and jitter rather than a single reading. */
export async function pingStats(host: string, count = 4): Promise<PingStats> {
  if (!isSafeHost(host)) return { avgMs: null, lossPct: 100, jitterMs: 0 }

  const cmd =
    platform === 'win32'
      ? `ping -n ${count} -w 1500 ${host}`
      : platform === 'darwin'
        ? `ping -c ${count} -W 1500 ${host}`
        : `ping -c ${count} -W 2 ${host}`

  const { stdout } = await run(cmd, count * 2000 + 3000)
  return summarisePings(stdout, count)
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

/**
 * What the home screen shows, and nothing else: router and internet latency.
 * The full diagnostic also reads the IP config, resolves DNS and probes four
 * hosts several times, which is far more than two numbers need.
 */
export async function quickCheck(fresh = false): Promise<QuickReport> {
  const gateway = (await defaultRoute(fresh))?.gateway ?? null
  const [routerMs, a, b] = await Promise.all([
    gateway ? ping(gateway) : Promise.resolve(null),
    ping('1.1.1.1'),
    ping('8.8.8.8'),
  ])
  return { gateway, routerMs, internetMs: a ?? b, online: a !== null || b !== null }
}

export async function runDiagnostics(): Promise<DiagnosticsReport> {
  const gateway = await gatewayAddress()
  const targets = gateway ? [{ label: 'Router', target: gateway }, ...BASE_TARGETS] : BASE_TARGETS

  const [pings, ipConfig, dns] = await Promise.all([
    Promise.all(
      targets.map(async ({ label, target }): Promise<PingResult> => {
        const s = await pingStats(target)
        return {
          label,
          target,
          ms: s.avgMs,
          ok: s.avgMs !== null,
          lossPct: s.lossPct,
          jitterMs: s.jitterMs,
        }
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
