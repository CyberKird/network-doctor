import type { SpeedProgress } from '../../shared/types'

const ENDPOINT = 'https://speed.cloudflare.com/__down?bytes='
/** Per request. The endpoint refuses anything much above this with a 403. */
const REQUEST_BYTES = 50_000_000
const STREAMS = 3
/** Measured from the first byte received, so connection setup is not counted. */
const DURATION_MS = 6000
/** TCP starts slow; the first stretch understates what the link can carry. */
const WARMUP_MS = 1200
const PROGRESS_EVERY_MS = 120

/**
 * Download speed against Cloudflare's endpoint, over several parallel streams.
 *
 * One connection rarely fills a fast line, and a fixed 25 MB payload finished
 * on a good connection before TCP had ramped up, so the number came out low and
 * varied from run to run. This runs for a fixed window instead and reports the
 * rate after the ramp-up, which settles to the same figure each time.
 *
 * Progress is sampled on a timer rather than per chunk: a chunk arrives every
 * few milliseconds, and an IPC message for each one is pure overhead for a
 * number that is only drawn once per frame.
 *
 * Aborting `signal` is the user stopping the test and rejects; the window
 * running out is the normal end and resolves.
 */
export async function measureDownload(
  onProgress: (p: SpeedProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  const testWindow = new AbortController()
  const stopWindow = (): void => testWindow.abort()
  signal?.addEventListener('abort', stopWindow, { once: true })

  let received = 0
  let started = 0
  let warmBytes = -1
  let warmAt = 0
  let endTimer: ReturnType<typeof setTimeout> | undefined

  const rate = (now: number): number => {
    if (started === 0) return 0
    if (warmBytes >= 0 && now - warmAt > 250) {
      return ((received - warmBytes) * 8) / ((now - warmAt) / 1000) / 1e6
    }
    return (received * 8) / (Math.max(now - started, 1) / 1000) / 1e6
  }

  const ticker = setInterval(() => {
    const now = performance.now()
    if (started !== 0 && warmBytes < 0 && now - started >= WARMUP_MS) {
      warmBytes = received
      warmAt = now
    }
    if (started !== 0) onProgress({ mbps: rate(now), bytes: received, done: false })
  }, PROGRESS_EVERY_MS)

  /** One connection that keeps requesting until the window closes, so a fast link is never left idle. */
  const stream = async (id: number): Promise<void> => {
    for (let n = 0; !testWindow.signal.aborted; n++) {
      const response = await fetch(`${ENDPOINT}${REQUEST_BYTES}&r=${id}-${n}-${Date.now()}`, {
        signal: testWindow.signal,
        headers: { 'User-Agent': 'network-doctor/4', 'Cache-Control': 'no-store' },
      })
      if (!response.ok || !response.body) {
        throw new Error(`Speed test endpoint returned ${response.status}`)
      }
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        if (started === 0) {
          started = performance.now()
          endTimer = setTimeout(stopWindow, DURATION_MS)
        }
        received += value.byteLength
      }
    }
  }

  try {
    const results = await Promise.allSettled(Array.from({ length: STREAMS }, (_, i) => stream(i)))
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const end = performance.now()
    if (started === 0 || received === 0) {
      const failure = results.find((r) => r.status === 'rejected')
      throw failure && failure.status === 'rejected' ? failure.reason : new Error('No data received')
    }

    const mbps = rate(end)
    onProgress({ mbps, bytes: received, done: true })
    return mbps
  } finally {
    clearInterval(ticker)
    clearTimeout(endTimer)
    signal?.removeEventListener('abort', stopWindow)
  }
}
