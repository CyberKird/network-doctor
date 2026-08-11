import { useState } from 'react'
import type { AppSettings, PlatformInfo, ThemeMode } from '../../../shared/types'
import type { Toast } from '../App'

interface Props {
  settings: AppSettings
  info: PlatformInfo | null
  onChange: (settings: AppSettings) => void
  notify: (text: string, kind?: Toast['kind']) => void
}

const THEMES: Array<{ id: ThemeMode; label: string }> = [
  { id: 'light', label: 'Luminos' },
  { id: 'dark', label: 'Întunecat' },
  { id: 'system', label: 'Ca sistemul' },
]

const OS_NAME: Record<PlatformInfo['platform'], string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}

export default function Settings({ settings, info, onChange, notify }: Props) {
  const [password, setPassword] = useState('')

  const setTheme = async (theme: ThemeMode): Promise<void> => {
    await window.api.setTheme(theme)
    onChange({ ...settings, theme })
  }

  const toggleAutoUpdate = async (): Promise<void> => {
    const next = !settings.autoUpdate
    await window.api.setAutoUpdate(next)
    onChange({ ...settings, autoUpdate: next })
  }

  const savePassword = async (): Promise<void> => {
    const result = await window.api.setRouterPassword(password)
    if (result.ok) {
      setPassword('')
      onChange({ ...settings, hasRouterPassword: password.length > 0 })
      notify(password ? 'Parola a fost salvată în seiful sistemului' : 'Parola a fost ștearsă')
    } else {
      notify(result.error ?? 'Nu am putut salva parola', 'error')
    }
  }

  return (
    <div className="screen">
      <div className="card">
        <div className="setting-row">
          <div className="setting-row__text">
            <h3>Temă</h3>
            <p>Neumorfismul funcționează în ambele variante; „Ca sistemul" urmărește setarea din OS.</p>
          </div>
          <div className="row">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="chip"
                aria-pressed={settings.theme === t.id}
                onClick={() => void setTheme(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <h3>Verifică actualizările</h3>
            <p>Caută versiuni noi la pornire, din pagina de Releases a proiectului.</p>
          </div>
          <button
            type="button"
            className="toggle"
            role="switch"
            aria-checked={settings.autoUpdate}
            aria-label="Verifică actualizările"
            onClick={() => void toggleAutoUpdate()}
          />
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <h3>Parola routerului</h3>
            <p>
              Se păstrează în seiful sistemului de operare, nu în clar pe disc, și se copiază
              automat când deschizi pagina routerului.
              {settings.hasRouterPassword && ' O parolă este deja salvată.'}
            </p>
          </div>
          <div className="row">
            <div className="field" style={{ width: 240 }}>
              <input
                type="password"
                value={password}
                placeholder={settings.hasRouterPassword ? '••••••••' : 'Parolă router'}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </div>
            <button type="button" className="btn btn--primary" onClick={() => void savePassword()}>
              Salvează
            </button>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-row__text">
            <h3>Despre</h3>
            <p>
              Network Doctor v{info?.version ?? '—'} · {info ? OS_NAME[info.platform] : '—'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void window.api.openExternal('https://github.com/CyberKird/network-doctor')}
          >
            Deschide GitHub
          </button>
        </div>
      </div>
    </div>
  )
}
