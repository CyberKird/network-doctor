import { Resolver, getServers } from 'node:dns'
import type { DnsBenchmarkRow } from '../../shared/types'

const PROVIDERS: Array<{ label: string; server: string }> = [
  { label: 'Cloudflare', server: '1.1.1.1' },
  { label: 'Google', server: '8.8.8.8' },
  { label: 'Quad9', server: '9.9.9.9' },
  { label: 'OpenDNS', server: '208.67.222.222' },
]

/** Popular names, so the answer is usually already cached at the resolver - the case users actually live in. */
const DOMAINS = ['google.com', 'wikipedia.org', 'amazon.com', 'github.com', 'netflix.com']

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Query one server directly (bypassing the OS cache) and return the median answer time. */
async function timeServer(server: string): Promise<number | null> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 })
  resolver.setServers([server])
  const times: number[] = []
  for (const domain of DOMAINS) {
    const start = performance.now()
    try {
      await new Promise<void>((resolve, reject) =>
        resolver.resolve4(domain, (err) => (err ? reject(err) : resolve())),
      )
      times.push(performance.now() - start)
    } catch {
      /* a failed lookup is simply not a sample; no samples at all means "no answer" */
    }
  }
  return median(times)
}

/**
 * How fast each public resolver answers from this connection, plus whichever
 * server the system is using now. Fastest first; servers that never answered last.
 */
export async function benchmarkDns(): Promise<DnsBenchmarkRow[]> {
  const system = getServers().find((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s))
  const targets = [...PROVIDERS]
  if (system && !targets.some((t) => t.server === system)) {
    targets.push({ label: 'Sistem', server: system })
  }

  const rows = await Promise.all(
    targets.map(async (t): Promise<DnsBenchmarkRow> => {
      const ms = await timeServer(t.server)
      return {
        label: t.label,
        server: t.server,
        ms: ms === null ? null : Math.round(ms),
        current: t.server === system,
      }
    }),
  )
  return rows.sort((a, b) => (a.ms ?? Infinity) - (b.ms ?? Infinity))
}
