import { useCallback, useEffect, useRef, useState } from 'react'
import HeroButton from '../components/HeroButton'
import { useCountUp } from '../hooks/useCountUp'
import type { Toast } from '../App'

interface Props {
  notify: (text: string, kind?: Toast['kind']) => void
  onOnlineChange: (online: boolean) => void
}

interface Stat {
  label: string
  value: string
  unit?: string
  active?: boolean
}

export default function Home({ notify, onOnlineChange }: Props) {
  const [gateway, setGateway] = useState<string | null>(null)
  const [routerMs, setRouterMs] = useState<number | null>(null)
  const [internetMs, setInternetMs] = useState<number | null>(null)
  const [mbps, setMbps] = useState<number | null>(null)
  const [testing, setTesting] = useState(false)
  const [opening, setOpening] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const report = await window.api.runDiagnostics()
    if (!alive.current) return
    setGateway(report.gateway)
    setRouterMs(report.pings.find((p) => p.label === 'Router')?.ms ?? null)
    setInternetMs(report.pings.find((p) => p.label === 'Cloudflare')?.ms ?? null)
    onOnlineChange(report.online)
  }, [onOnlineChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openRouter = async (): Promise<void> => {
    setOpening(true)
    const result = await window.api.openRouter()
    setOpening(false)
    notify(result.message, result.ok ? 'success' : 'error')
  }

  const runSpeedTest = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    setMbps(0)
    const off = window.api.onSpeedProgress((p) => alive.current && setMbps(p.mbps))
    try {
      const final = await window.api.startSpeedTest()
      if (final === null) {
        // Stopped on purpose. Whatever had been measured so far stays on the
        // tile - it is a partial reading, not a failure worth wiping.
        notify('Test oprit', 'warning')
      } else {
        if (alive.current) setMbps(final)
        notify(`Download: ${final.toFixed(1)} Mb/s`)
      }
    } catch (err) {
      if (alive.current) setMbps(null)
      notify(err instanceof Error ? err.message : 'Testul de viteză a eșuat', 'error')
    } finally {
      off()
      if (alive.current) setTesting(false)
    }
  }

  // The speed test already streams a moving number, so only the two latency
  // readings - which arrive as a single jump - are worth easing.
  const routerShown = useCountUp(routerMs)
  const internetShown = useCountUp(internetMs)

  const stats: Stat[] = [
    { label: 'Router', value: routerShown === null ? '—' : routerShown.toFixed(0), unit: 'ms' },
    { label: 'Internet', value: internetShown === null ? '—' : internetShown.toFixed(0), unit: 'ms' },
    {
      label: 'Download',
      value: mbps === null ? '—' : mbps.toFixed(mbps >= 100 ? 0 : 1),
      unit: 'Mb/s',
      active: testing,
    },
  ]

  return (
    <div className="screen">
      <div className="home">
        <div className="home__stage">
          <HeroButton lines={['RESTART', 'ROUTER']} busy={opening} onClick={openRouter} />
          <p className="card__subtitle">
            {gateway ? `Deschide ${gateway} și copiază parola` : 'Caut adresa routerului…'}
          </p>
        </div>

        <div className="home__side">
          <div className="stat-row" style={{ gridTemplateColumns: '1fr' }}>
            {stats.map((s) => (
              <div key={s.label} className={`stat ${s.active ? 'stat--active' : ''}`}>
                <span className="stat__label">{s.label}</span>
                <span className="stat__value">
                  {s.value}
                  {s.unit && <span className="stat__unit">{s.unit}</span>}
                </span>
              </div>
            ))}
          </div>

          {testing ? (
            <div className="split">
              <span className="btn btn--primary split__main" aria-live="polite">
                Se testează…
              </span>
              <button
                type="button"
                className="btn btn--danger split__stop"
                onClick={() => void window.api.cancelSpeedTest()}
                aria-label="Oprește testul de viteză"
                title="Oprește testul"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <circle
                    cx="12"
                    cy="12"
                    r="9.25"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  />
                  <rect x="8.5" y="8.5" width="7" height="7" rx="1.1" fill="currentColor" />
                </svg>
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--primary btn--block" onClick={runSpeedTest}>
              Test viteză
            </button>
          )}
          <button type="button" className="btn btn--block" onClick={() => void refresh()}>
            Reverifică
          </button>
        </div>
      </div>
    </div>
  )
}
