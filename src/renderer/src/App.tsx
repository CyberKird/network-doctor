import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, PlatformInfo, ThemeMode } from '../../shared/types'
import Tabs from './components/Tabs'
import Home from './screens/Home'
import Diagnostics from './screens/Diagnostics'
import Tools from './screens/Tools'
import Settings from './screens/Settings'

const TABS = ['Acasă', 'Diagnostic', 'Unelte', 'Setări'] as const
type Tab = (typeof TABS)[number]

export interface Toast {
  id: number
  text: string
  kind: 'success' | 'warning' | 'error'
}

const ICONS: Record<Toast['kind'], string> = {
  success: 'M20 6 9 17l-5-5',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  error: 'M12 8v5m0 3h.01M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z',
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Acasă')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [info, setInfo] = useState<PlatformInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const nextId = useRef(0)

  const notify = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  useEffect(() => {
    window.api.getPlatformInfo().then(setInfo)
    window.api.getSettings().then(setSettings)
  }, [])

  useEffect(
    () =>
      window.api.onUpdateAvailable((version) =>
        notify(`Versiunea ${version} este disponibilă - vezi Setări`, 'warning'),
      ),
    [notify],
  )

  // The renderer follows the OS when the theme is "system", so the class has to
  // react to the media query rather than only to the stored setting.
  useEffect(() => {
    if (!settings) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved: Exclude<ThemeMode, 'system'> =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  // Same idea for motion. Windows reports "reduce" whenever its own animation
  // effects are off, so the stored setting can override the system.
  useEffect(() => {
    if (!settings) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (): void => {
      const reduced =
        settings.motion === 'system' ? media.matches : settings.motion === 'off'
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  return (
    <div className="app">
      <header className="app__top">
        <div className="brand">
          <h1 className="brand__name">Network Doctor</h1>
          <span className="brand__meta">v{info?.version ?? '—'}</span>
        </div>

        <div className="row">
          <span className="status">
            <span
              className={`status__dot ${
                online === null ? '' : online ? 'status__dot--online' : 'status__dot--offline'
              }`}
            />
            {online === null ? 'se verifică…' : online ? 'Conectat' : 'Fără internet'}
          </span>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>
      </header>

      <main className="app__body">
        {tab === 'Acasă' && <Home notify={notify} onOnlineChange={setOnline} />}
        {tab === 'Diagnostic' && <Diagnostics notify={notify} onOnlineChange={setOnline} />}
        {tab === 'Unelte' && <Tools notify={notify} isAdmin={info?.isAdmin ?? false} />}
        {tab === 'Setări' && settings && (
          <Settings settings={settings} onChange={setSettings} notify={notify} info={info} />
        )}
      </main>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`alert alert--${t.kind} toast`}>
            <svg
              className="alert__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={ICONS[t.kind]} />
            </svg>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
