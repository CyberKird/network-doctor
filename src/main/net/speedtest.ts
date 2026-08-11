import type { SpeedProgress } from '../../shared/types'

const ENDPOINT = 'https://speed.cloudflare.com/__down?bytes='
const PAYLOAD_BYTES = 25_000_000

/**
 * Download-only speed measurement against Cloudflare's endpoint.
 *
 * Progress is reported while the stream is read so the gauge can move instead
 * of jumping once at the end. Timing starts at the first received chunk, so
 * connection setup is not counted as transfer time.
 */
export async function measureDownload(
  onProgress: (p: SpeedProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  const response = await fetch(`${ENDPOINT}${PAYLOAD_BYTES}`, {
    signal,
    headers: { 'User-Agent': 'network-doctor/4.0', 'Cache-Control': 'no-store' },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Speed test endpoint returned ${response.status}`)
  }

  const reader = response.body.getReader()
  let received = 0
  let started = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    if (started === 0) started = performance.now()
    received += value.byteLength

    const seconds = (performance.now() - started) / 1000
    if (seconds > 0) {
      onProgress({ mbps: (received * 8) / seconds / 1e6, bytes: received, done: false })
    }
  }

  const seconds = (performance.now() - started) / 1000
  if (started === 0 || seconds <= 0) throw new Error('No data received')

  const mbps = (received * 8) / seconds / 1e6
  onProgress({ mbps, bytes: received, done: true })
  return mbps
}
