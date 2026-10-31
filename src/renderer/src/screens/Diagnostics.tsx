import { useCallback, useEffect, useState } from 'react'
import type { DiagnosticsReport, DnsBenchmarkRow } from '../../../shared/types'
import type { Toast } from '../App'

interface Props {
  notify: (text: string, kind?: Toast['kind']) => void
  onOnlineChange: (online: boolean) => void
}

/** Last results, shown at once on return while a fresh run happens behind them. */
let lastReport: DiagnosticsReport | null = null
let lastDns: DnsBenchmarkRow[] | null = null

type Verdict = { kind: 'success' | 'warning' | 'error'; text: string }

/**
 * One sentence about the connection, from the readings that matter for it:
 * loss and jitter hurt calls and games long before the average latency does.
 * The router is left out of the internet verdict - a bad Wi-Fi hop to it shows
 * on its own row.
 */
function verdictFor(report: DiagnosticsReport): Verdict {
  const net = report.pings.filter((p) => p.label !== 'Router')
  if (!net.some((p) => p.ok)) return { kind: 'error', text: 'Fără internet: nicio țintă nu răspunde.' }
  const loss = Math.max(...net.map((p) => p.lossPct))
  const jitter = Math.max(...net.map((p) => p.jitterMs))
  const ms = Math.min(...net.filter((p) => p.ms !== null).map((p) => p.ms as number))
  if (loss >= 5 || jitter >= 30) {
    return { kind: 'warning', text: 'Conexiune instabilă: pierderi de pachete sau întârzieri care variază.' }
  }
  if (ms >= 100) return { kind: 'warning', text: 'Conexiune stabilă, dar cu latență mare.' }
  return { kind: 'success', text: 'Conexiune stabilă, fără pierderi.' }
}

export default function Diagnostics({ notify, onOnlineChange }: Props) {
  const [report, setReport] = useState<DiagnosticsReport | null>(lastReport)
  const [running, setRunning] = useState(false)
  const [dns, setDns] = useState<DnsBenchmarkRow[] | null>(lastDns)
  const [dnsRunning, setDnsRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    try {
      const next = await window.api.runDiagnostics()
      lastReport = next
      setReport(next)
      onOnlineChange(next.online)
    } finally {
      setRunning(false)
    }
  }, [onOnlineChange])

  useEffect(() => {
    void run()
  }, [run])

  const copyConfig = async (): Promise<void> => {
    if (!report) return
    await navigator.clipboard.writeText(report.ipConfig)
    notify('Configurația IP a fost copiată')
  }

  const runDns = async (): Promise<void> => {
    setDnsRunning(true)
    try {
      const rows = await window.api.benchmarkDns()
      lastDns = rows
      setDns(rows)
    } catch {
      notify('Testul DNS a eșuat', 'error')
    } finally {
      setDnsRunning(false)
    }
  }

  const verdict = report ? verdictFor(report) : null
  const fastest = dns?.[0]?.ms != null ? dns[0] : null

  return (
    <div className="screen">
      <div className="row spread">
        <div>
          <h2 className="card__title">Diagnostic</h2>
          <p className="card__subtitle">
            {report?.dnsResolves === false
              ? 'DNS-ul nu răspunde'
              : 'Ping către router și serverele publice'}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={copyConfig} disabled={!report}>
            Copiază config
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void run()}
            disabled={running}
          >
            {running ? 'Se rulează…' : 'Rulează din nou'}
          </button>
        </div>
      </div>

      <div className="ping-list">
        {(report?.pings ?? []).map((p, i) => (
          <div
            key={p.label}
            className="ping-row stagger"
            style={{ '--i': i } as React.CSSProperties}
          >
            <span>
              <strong>{p.label}</strong>{' '}
              <span className="card__subtitle" style={{ display: 'inline' }}>
                {p.target}
              </span>
            </span>
            <span className={`ping-row__value ${p.ok ? 'ok' : 'bad'}`}>
              {p.ok ? `${p.ms} ms` : 'TIMEOUT'}
              {p.ok && (
                <span className="ping-row__detail">
                  pierdere {p.lossPct}% · jitter {p.jitterMs} ms
                </span>
              )}
            </span>
          </div>
        ))}
        {!report && <div className="ping-row">Se rulează diagnosticul…</div>}
      </div>

      {verdict && <div className={`alert alert--${verdict.kind}`}>{verdict.text}</div>}

      <div className="dns">
        <div className="row spread">
          <div>
            <h3 className="dns__title">Viteza DNS</h3>
            <p className="card__subtitle">Care server răspunde cel mai repede de la tine.</p>
          </div>
          <button type="button" className="btn" onClick={() => void runDns()} disabled={dnsRunning}>
            {dnsRunning ? 'Se testează…' : dns ? 'Testează din nou' : 'Testează DNS'}
          </button>
        </div>
        {dns && (
          <div className="dns__grid">
            {dns.map((row) => (
              <div
                key={row.server}
                className={`dns__cell ${fastest?.server === row.server ? 'dns__cell--best' : ''}`}
              >
                <span className="stat__label">{row.label}</span>
                <span className="dns__ms">{row.ms === null ? 'fără răspuns' : `${row.ms} ms`}</span>
                <span className="dns__note">
                  {row.server}
                  {row.current && ' · folosit acum'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="log">{report?.ipConfig || 'Se citește configurația de rețea…'}</div>
    </div>
  )
}
