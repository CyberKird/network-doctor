import { useEffect, useState } from 'react'
import type { ToolView } from '../../../shared/types'
import type { Toast } from '../App'

interface Props {
  notify: (text: string, kind?: Toast['kind']) => void
  isAdmin: boolean
}

export default function Tools({ notify, isAdmin }: Props) {
  const [tools, setTools] = useState<ToolView[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    window.api.listTools().then(setTools)
  }, [])

  const execute = async (tool: ToolView): Promise<void> => {
    setConfirming(null)
    setBusy(tool.id)
    try {
      const result = await window.api.runTool(tool.id)
      notify(result.message, result.ok ? 'success' : 'error')
    } finally {
      setBusy(null)
    }
  }

  const click = (tool: ToolView): void => {
    if (tool.confirm && confirming !== tool.id) {
      setConfirming(tool.id)
      return
    }
    void execute(tool)
  }

  return (
    <div className="screen">
      <div>
        <h2 className="card__title">Unelte de reparare</h2>
        <p className="card__subtitle">
          {isAdmin
            ? 'Rulezi cu drepturi de administrator.'
            : 'Acțiunile marcate cer drepturi de administrator - sistemul îți va cere confirmarea.'}
        </p>
      </div>

      <div className="tool-grid">
        {tools.map((tool) => {
          const pending = confirming === tool.id
          return (
            <div key={tool.id} className={`tool ${tool.available ? 'surface' : 'surface--sunken'}`}>
              <div className="row spread grow" style={{ width: '100%' }}>
                <strong>{tool.label}</strong>
                {tool.elevated && tool.available && <span className="tool__badge">admin</span>}
              </div>

              {tool.available ? (
                <button
                  type="button"
                  className={`btn ${pending ? 'btn--danger' : 'btn--primary'} btn--block`}
                  onClick={() => click(tool)}
                  disabled={busy !== null}
                  onBlur={() => pending && setConfirming(null)}
                >
                  {busy === tool.id ? 'Se rulează…' : pending ? 'Sigur? Apasă din nou' : 'Rulează'}
                </button>
              ) : (
                <p className="tool__note">{tool.reason}</p>
              )}
            </div>
          )
        })}
        {tools.length === 0 && <p className="card__subtitle">Se încarcă uneltele…</p>}
      </div>
    </div>
  )
}
