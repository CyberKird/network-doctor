import { useState } from 'react'

interface Props {
  lines: [string, string]
  busy?: boolean
  onClick: () => void
}

/**
 * The app's signature control: a raised disc with a comet tracing its rim.
 *
 * The comet is a conic gradient masked to a ring and rotated by a CSS
 * animation, so the compositor advances it against the display's own refresh.
 * Nothing here schedules frames.
 */
export default function HeroButton({ lines, busy, onClick }: Props) {
  const [ripples, setRipples] = useState<number[]>([])

  const handleClick = (): void => {
    const id = Date.now()
    setRipples((r) => [...r, id])
    // Matches the ripple animation length; the node is only kept while it is
    // visibly playing.
    setTimeout(() => setRipples((r) => r.filter((x) => x !== id)), 600)
    onClick()
  }

  return (
    <button
      type="button"
      className={`hero ${busy ? 'hero--busy' : ''}`}
      onClick={handleClick}
      aria-label={lines.join(' ')}
    >
      <span className="hero__disc" />
      <span className="hero__comet" aria-hidden="true" />
      {ripples.map((id) => (
        <span key={id} className="hero__ripple" aria-hidden="true" />
      ))}
      <span className="hero__label">
        <span className="hero__line">{lines[0]}</span>
        <span className="hero__line">{lines[1]}</span>
      </span>
    </button>
  )
}
