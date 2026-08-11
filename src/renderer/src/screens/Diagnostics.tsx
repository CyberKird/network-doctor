import { useCallback, useEffect, useState } from 'react'
import type { DiagnosticsReport } from '../../../shared/types'
import type { Toast } from '../App'

interface Props {
  notify: (text: string, kind?: Toast['kind']) => void
  onOnlineChange: (online: boolean) => void
}

export default function Diagnostics({ notify, onOnlineChange }: Props) {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    try {
      const next = await window.api.runDiagnostics()
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
        {(report?.pings ?? []).map((p) => (
          <div key={p.label} className="ping-row">
            <span>
              <strong>{p.label}</strong>{' '}
              <span className="card__subtitle" style={{ display: 'inline' }}>
                {p.target}
              </span>
            </span>
            <span className={`ping-row__value ${p.ok ? 'ok' : 'bad'}`}>
              {p.ok ? `${p.ms} ms` : 'TIMEOUT'}
            </span>
          </div>
        ))}
        {!report && <div className="ping-row">Se rulează diagnosticul…</div>}
      </div>

      <div className="log">{report?.ipConfig || 'Se citește configurația de rețea…'}</div>
    </div>
  )
}
