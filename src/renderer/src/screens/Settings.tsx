import { useState } from 'react'
import type { AppSettings, MotionMode, PlatformInfo, ThemeMode } from '../../../shared/types'
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

const MOTIONS: Array<{ id: MotionMode; label: string }> = [
  { id: 'on', label: 'Pornite' },
  { id: 'system', label: 'Ca sistemul' },
  { id: 'off', label: 'Oprite' },
]

const OS_NAME: Record<PlatformInfo['platform'], string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  )
}

export default function Settings({ settings, info, onChange, notify }: Props) {
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)

  const setTheme = async (theme: ThemeMode): Promise<void> => {
    await window.api.setTheme(theme)
    onChange({ ...settings, theme })
  }

  const setMotion = async (motion: MotionMode): Promise<void> => {
    await window.api.setMotion(motion)
    onChange({ ...settings, motion })
  }

  const toggleAutoUpdate = async (): Promise<void> => {
    const next = !settings.autoUpdate
    await window.api.setAutoUpdate(next)
    onChange({ ...settings, autoUpdate: next })
  }

  /**
   * Revealing pulls the stored password out of the OS keystore, but only if
   * the box is empty - if something has been typed, that is what the user
   * wants to look at, and overwriting it would lose their edit.
   */
  const toggleReveal = async (): Promise<void> => {
    if (revealed) {
      setRevealed(false)
      return
    }
    if (!password && settings.hasRouterPassword) {
      const stored = await window.api.revealRouterPassword()
      if (stored === null) {
        notify('Nu am putut citi parola din seiful sistemului', 'error')
        return
      }
      setPassword(stored)
    }
    setRevealed(true)
  }

  const savePassword = async (): Promise<void> => {
    const result = await window.api.setRouterPassword(password)
    if (result.ok) {
      // The field keeps what was saved. Clearing it here made a successful save
      // look like the password had been lost, and there is nothing to hide: the
      // eye is right there to mask it again.
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
            <h3>Animații</h3>
            <p>
              Windows raportează „mișcare redusă" și când ai oprit efectele lui vizuale, ceea ce ar
              îngheța animațiile din aplicație. Alege „Pornite" ca să le vezi oricum.
            </p>
          </div>
          <div className="row">
            {MOTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="chip"
                aria-pressed={settings.motion === m.id}
                onClick={() => void setMotion(m.id)}
              >
                {m.label}
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
            <div className="field" style={{ width: 260 }}>
              <input
                type={revealed ? 'text' : 'password'}
                value={password}
                placeholder={settings.hasRouterPassword ? '••••••••' : 'Parolă router'}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
              <button
                type="button"
                className="field__action"
                onClick={() => void toggleReveal()}
                aria-pressed={revealed}
                aria-label={revealed ? 'Ascunde parola' : 'Arată parola'}
                title={revealed ? 'Ascunde parola' : 'Arată parola'}
              >
                <EyeIcon off={revealed} />
              </button>
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
