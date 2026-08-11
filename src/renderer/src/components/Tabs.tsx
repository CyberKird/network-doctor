import { useLayoutEffect, useRef, useState } from 'react'

interface Props<T extends string> {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
}

/**
 * Segmented control whose pill glides to the selected tab.
 *
 * The pill's position is measured from the real tab elements rather than
 * assumed to be an equal share of the width, so it stays correct when a label
 * is translated into something longer.
 */
export default function Tabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const measure = (): void => {
      const index = tabs.indexOf(active)
      const el = list.children[index + 1] as HTMLElement | undefined // +1: pill is first
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    return () => observer.disconnect()
  }, [active, tabs])

  return (
    <div className="tabs" role="tablist" ref={listRef}>
      <span
        className="tabs__pill"
        style={pill ? { left: pill.left, width: pill.width } : { opacity: 0 }}
        aria-hidden="true"
      />
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="tabs__tab"
          aria-selected={tab === active}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
