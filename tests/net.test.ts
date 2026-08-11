import { strict as assert } from 'node:assert'
import { after, describe, it } from 'node:test'
import { isIpAddress, isSafeInterfaceName, run, shellQuote } from '../src/main/net/exec'
import {
  TOOLS,
  gatewayAddress,
  ipConfiguration,
  platform,
  primaryInterface,
  toolsForThisPlatform,
} from '../src/main/net/capabilities'
import { ping, runDiagnostics } from '../src/main/net/diagnostics'

describe('input guards', () => {
  it('accepts real addresses and rejects malformed ones', () => {
    for (const good of ['192.168.1.1', '10.0.0.254', '8.8.8.8', '0.0.0.0']) {
      assert.equal(isIpAddress(good), true, good)
    }
    for (const bad of ['192.168.1', '999.1.1.1', '1.1.1.1.1', '', 'a.b.c.d', '1.1.1.-1']) {
      assert.equal(isIpAddress(bad), false, bad)
    }
  })

  it('rejects interface names carrying shell metacharacters', () => {
    assert.equal(isSafeInterfaceName('Ethernet'), true)
    assert.equal(isSafeInterfaceName('Wi-Fi 2'), true)
    assert.equal(isSafeInterfaceName('en0'), true)
    // These are the shapes that would matter if one ever reached a command.
    for (const bad of ['eth0; rm -rf /', 'eth0 && curl x', 'eth0`id`', 'eth0$(id)', 'eth0|sh', '']) {
      assert.equal(isSafeInterfaceName(bad), false, bad)
    }
  })

  it('quotes strings so POSIX sh sees one argument', () => {
    assert.equal(shellQuote("it's"), `'it'\\''s'`)
    assert.equal(shellQuote('a b'), `'a b'`)
  })
})

describe('capability map', () => {
  it('defines every tool for all three platforms', () => {
    for (const tool of TOOLS) {
      for (const p of ['win32', 'darwin', 'linux'] as const) {
        const entry = tool.perPlatform[p]
        assert.ok(entry, `${tool.id} has no entry for ${p}`)
        const usable = 'unsupported' in entry ? entry.unsupported : entry.build
        assert.ok(usable, `${tool.id}/${p} is neither runnable nor explained`)
      }
    }
  })

  it('explains, rather than hides, what the platform cannot do', () => {
    const views = toolsForThisPlatform()
    assert.ok(views.length === TOOLS.length)
    for (const v of views) {
      if (!v.available) {
        assert.ok(v.reason && v.reason.length > 20, `${v.id} unavailable without a reason`)
      }
    }
  })

  it('keeps the Windows-only tools Windows-only', () => {
    for (const id of ['winsock', 'net_reset']) {
      const tool = TOOLS.find((t) => t.id === id)!
      assert.ok('build' in tool.perPlatform.win32)
      assert.ok('unsupported' in tool.perPlatform.darwin)
      assert.ok('unsupported' in tool.perPlatform.linux)
    }
  })
})

describe('live system probes', () => {
  it('runs a command and captures its output', async () => {
    const { ok, stdout } = await run(platform === 'win32' ? 'echo hello' : 'echo hello')
    assert.equal(ok, true)
    assert.match(stdout, /hello/)
  })

  it('reports failure instead of throwing', async () => {
    const { ok } = await run('definitely-not-a-real-command-xyz')
    assert.equal(ok, false)
  })

  it('times out instead of hanging forever', async () => {
    const sleep = platform === 'win32' ? 'ping -n 6 127.0.0.1' : 'sleep 5'
    const started = Date.now()
    const { ok, stderr } = await run(sleep, 700)
    assert.equal(ok, false)
    assert.match(stderr, /timed out/)
    assert.ok(Date.now() - started < 3000, 'timeout did not cut the command short')
  })

  it('finds the active interface', async () => {
    const iface = await primaryInterface()
    assert.ok(iface, 'no active interface detected')
    assert.equal(isSafeInterfaceName(iface), true)
  })

  it('finds the default gateway', async () => {
    const gw = await gatewayAddress()
    assert.ok(gw, 'no default gateway detected')
    assert.equal(isIpAddress(gw), true)
  })

  it('reads the IP configuration', async () => {
    const text = await ipConfiguration()
    assert.ok(text.length > 40, 'IP configuration looks empty')
  })

  it('parses a ping round-trip time', async () => {
    const ms = await ping('1.1.1.1')
    // Offline machines are allowed to return null; a wrong parse is not.
    if (ms !== null) {
      assert.ok(Number.isFinite(ms) && ms >= 0 && ms < 5000, `implausible rtt ${ms}`)
    }
  })

  it('refuses hostnames that are not hostnames', async () => {
    assert.equal(await ping('8.8.8.8; whoami'), null)
    assert.equal(await ping('$(id)'), null)
  })

  it('produces a complete report', async () => {
    const report = await runDiagnostics()
    assert.ok(report.pings.length >= 3)
    assert.equal(typeof report.online, 'boolean')
    assert.equal(typeof report.dnsResolves, 'boolean')
    assert.ok(report.ipConfig.length > 0)
  })
})

after(() => {
  console.log(`\n  platform under test: ${platform}`)
})
