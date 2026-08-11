import { useEffect, useRef, useState } from 'react'

/**
 * Ease a displayed number towards a new target instead of snapping to it.
 *
 * requestAnimationFrame is driven by the compositor, so the count lands one
 * step per display refresh with no frame pacing of our own. It starts from
 * whatever is currently shown rather than from zero, so a value that only
 * shifts a little does not run the whole way up again.
 */
export function useCountUp(target: number | null, duration = 700): number | null {
  const [shown, setShown] = useState<number | null>(target)
  const frame = useRef(0)
  const from = useRef(target ?? 0)

  useEffect(() => {
    if (target === null) {
      setShown(null)
      return
    }

    const reduced = document.documentElement.dataset.motion === 'reduced'
    if (reduced || from.current === target) {
      from.current = target
      setShown(target)
      return
    }

    const start = performance.now()
    const origin = from.current

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const value = origin + (target - origin) * eased
      setShown(value)
      if (t < 1) {
        frame.current = requestAnimationFrame(step)
      } else {
        from.current = target
      }
    }

    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [target, duration])

  return shown
}
