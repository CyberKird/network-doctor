import { useCallback, useEffect, useState } from 'react'
import type { AdapterActionResult, AdapterView, PlatformInfo } from '../../../shared/types'
import type { Toast } from '../App'

interface Props {
  notify: (text: string, kind?: Toast['kind']) => void
  platform: PlatformInfo['platform'] | null
}

type Job = 'toggle' | 'boost' | 'revert'

/**
 * Kept across visits so returning to the tab paints the last list at once and
 * refreshes behind it, instead of starting from an empty screen every time.
 */
let cache: AdapterView[] | null = null

const ICONS: Record<AdapterView['kind'], string[]> = {
  wifi: [
    'M5 12.55a11 11 0 0 1 14.08 0',
    'M1.42 9a16 16 0 0 1 21.16 0',
    'M8.53 16.11a6 6 0 0 1 6.95 0',
    'M12 20h.01',
  ],
  ethernet: [
    'm15 20 3-3h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2l3 3z',
    'M6 8v1',
    'M10 8v1',
    'M14 8v1',
    'M18 8v1',
  ],
}

function statusLabel(a: AdapterView): string {
  if (a.status === 'up') return a.speed ? `Conectat · ${a.speed}` : 'Conectat'
  return a.status === 'disabled' ? 'Dezactivat' : 'Neconectat'
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

export default function Adapters({ notify, platform }: Props) {
  const [adapters, setAdapters] = useState<AdapterView[] | null>(cache)
  const [busy, setBusy] = useState<Record<string, Job>>({})
  /** What a switch was just flipped to, shown at once while Windows catches up. */
  const [wanted, setWanted] = useState<Record<string, boolean>>({})
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      cache = await window.api.listAdapters()
      setAdapters(cache)
    } catch {
      notify('Nu am putut citi lista adaptoarelor', 'error')
    }
  }, [notify])

  useEffect(() => {
    if (platform === 'win32') void load()
  }, [platform, load])

  const act = async (
    a: AdapterView,
    job: Job,
    call: () => Promise<AdapterActionResult>,
  ): Promise<void> => {
    setConfirming(null)
    setBusy((b) => ({ ...b, [a.name]: job }))
    try {
      const result = await call()
      notify(result.message, result.ok ? 'success' : 'warning')
      await load()
    } finally {
      setBusy((b) => without(b, a.name))
      setWanted((w) => without(w, a.name))
    }
  }

  const toggle = (a: AdapterView, enabled: boolean): void => {
    setWanted((w) => ({ ...w, [a.name]: enabled }))
    void act(a, 'toggle', () => window.api.setAdapterEnabled(a.name, enabled))
  }

  const boost = (a: AdapterView): void => {
    // The adapter restarts and the connection drops for a few seconds, so it
    // takes a second press - same pattern as the repair tools.
    if (confirming !== a.name) {
      setConfirming(a.name)
      return
    }
    void act(a, 'boost', () => window.api.boostAdapter(a.name))
  }

  return (
    <div className="screen">
      <div className="row spread">
        <div>
          <h2 className="card__title">Adaptoare de rețea</h2>
          <p className="card__subtitle">
            Pornește sau oprește plăcile de rețea. Performance boost oprește economia de energie
            a driverului și repornește adaptorul scurt.
          </p>
        </div>
        {platform === 'win32' && (
          <button type="button" className="btn" onClick={() => void load()}>
            Reîmprospătează
          </button>
        )}
      </div>

      {platform !== null && platform !== 'win32' && (
        <p className="surface--sunken adapters__note">
          Controlul adaptoarelor folosește setările driverelor din Windows, deci nu există pe
          această platformă.
        </p>
      )}

      <div className="adapter-list">
        {adapters?.map((a, i) => {
          const job = busy[a.name]
          const enabled = wanted[a.name] ?? a.status !== 'disabled'
          const pending = confirming === a.name
          return (
            <div
              key={a.name}
              className="adapter surface stagger"
              data-status={job ? 'busy' : a.status}
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="adapter__icon">
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {ICONS[a.kind].map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
              </div>

              <div className="adapter__info">
                <strong className="adapter__name">{a.name}</strong>
                <span className="adapter__desc">{a.description}</span>
                <span className="adapter__status">
                  <span className="adapter__dot" />
                  {job ? 'Se aplică…' : statusLabel(a)}
                </span>
              </div>

              <div className="adapter__actions">
                {a.boosted ? (
                  <>
                    <span className="adapter__badge">Boost activ</span>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      disabled={Boolean(job)}
                      onClick={() => void act(a, 'revert', () => window.api.revertAdapter(a.name))}
                    >
                      Revino
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`btn ${pending ? 'btn--danger' : 'btn--primary'}`}
                    disabled={Boolean(job) || a.status === 'disabled'}
                    onClick={() => boost(a)}
                    onBlur={() => pending && setConfirming(null)}
                  >
                    {job === 'boost'
                      ? 'Se aplică…'
                      : pending
                        ? 'Sigur? Apasă din nou'
                        : 'Performance boost'}
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? 'Dezactivează' : 'Activează'} ${a.name}`}
                  className="toggle"
                  disabled={Boolean(job)}
                  onClick={() => toggle(a, !enabled)}
                />
              </div>
            </div>
          )
        })}
        {platform === 'win32' && adapters === null && (
          <p className="card__subtitle">Se caută adaptoarele…</p>
        )}
        {platform === 'win32' && adapters?.length === 0 && (
          <p className="card__subtitle">Nu am găsit adaptoare fizice.</p>
        )}
      </div>
    </div>
  )
}
