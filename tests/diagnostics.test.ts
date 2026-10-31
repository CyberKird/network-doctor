import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { defaultRoute, forgetRoute } from '../src/main/net/capabilities'
import { summarisePings } from '../src/main/net/diagnostics'
import { benchmarkDns } from '../src/main/net/dnsbench'

describe('ping summary', () => {
  it('averages replies and measures jitter from consecutive differences', () => {
    const out = [
      'Reply from 1.1.1.1: bytes=32 time=10ms TTL=57',
      'Reply from 1.1.1.1: bytes=32 time=14ms TTL=57',
      'Reply from 1.1.1.1: bytes=32 time=10ms TTL=57',
      'Reply from 1.1.1.1: bytes=32 time=14ms TTL=57',
    ].join('\n')
    assert.deepEqual(summarisePings(out, 4), { avgMs: 12, lossPct: 0, jitterMs: 4 })
  })

  it('counts a probe with no reply line as lost, whatever language the summary is in', () => {
    const out = [
      'Reply from 8.8.8.8: bytes=32 time=20ms TTL=117',
      'Request timed out.',
      'Reply from 8.8.8.8: bytes=32 time=20ms TTL=117',
      'Pachete: trimise = 4, primite = 2, pierdute = 2 (50% pierdere)',
    ].join('\n')
    const s = summarisePings(out, 4)
    assert.equal(s.lossPct, 50)
    assert.equal(s.avgMs, 20)
  })

  it('treats "time<1ms" as sub-millisecond and total silence as 100% loss', () => {
    assert.equal(summarisePings('Reply from 192.168.0.1: bytes=32 time<1ms TTL=64', 1).avgMs, 1)
    assert.deepEqual(summarisePings('Request timed out.\nRequest timed out.', 2), {
      avgMs: null,
      lossPct: 100,
      jitterMs: 0,
    })
  })
})

describe('route cache', () => {
  it('shares one lookup between callers and refreshes on demand', async () => {
    forgetRoute()
    const first = defaultRoute()
    const second = defaultRoute() // joins the lookup still in flight
    assert.deepEqual(await first, await second)

    const started = performance.now()
    await defaultRoute()
    assert.ok(performance.now() - started < 50, 'a cached answer should not respawn PowerShell')
  })
})

describe('dns benchmark', () => {
  it('returns every provider, fastest first, with unreachable ones last', async () => {
    const rows = await benchmarkDns()
    assert.ok(rows.length >= 4)
    const times = rows.map((r) => r.ms ?? Infinity)
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
  })
})
