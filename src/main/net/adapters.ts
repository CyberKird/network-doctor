import { execFile } from 'node:child_process'
import type { AdapterKind, AdapterStatus } from '../../shared/types'

/**
 * Physical network adapters on Windows: list, switch on/off, and a performance
 * boost that turns off the driver's power-saving features.
 *
 * Nothing in here touches Electron, so it can be tested in plain Node. Callers
 * persist the "undo" values themselves.
 *
 * Scripts go to powershell.exe directly (no cmd.exe in between) as
 * -EncodedCommand. They carry adapter and driver setting names, and this way
 * no quoting layer decides what gets executed - nor does cmd.exe's 8191
 * character line limit apply to a boost script that grows with the driver.
 */

const encode = (script: string): string => Buffer.from(script, 'utf16le').toString('base64')

interface PsResult {
  code: number | null
  stdout: string
  stderr: string
}

function powershell(script: string, timeoutMs: number): Promise<PsResult> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(script)],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const code = !err ? 0 : typeof err.code === 'number' ? err.code : null
        resolve({ code, stdout, stderr })
      },
    )
  })
}

/** ERROR_CANCELLED: what Windows reports when the UAC prompt is dismissed. */
export const UAC_DECLINED = 1223

/**
 * Single-quoted PowerShell string. PowerShell also treats the typographic
 * single quotes as delimiters, so those are doubled too.
 */
const q = (s: string): string => `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`

/**
 * Driver setting -> the value worth wanting. A setting the driver does not
 * expose is simply skipped, so one table serves Realtek, Intel and the USB
 * dongles alike. "max" means the driver's own numeric ceiling.
 */
export const BOOST_RULES: ReadonlyArray<readonly [string, RegExp | 'max']> = [
  ['Green Ethernet', /^disab/i],
  ['Energy-Efficient Ethernet', /^disab/i],
  ['Energy Efficient Ethernet', /^disab/i],
  ['Advanced EEE', /^disab/i],
  ['Power Saving Mode', /^disab/i],
  ['Ultra Low Power Mode', /^disab/i],
  ['Gigabit Lite', /^disab/i],
  ['Auto Disable Gigabit', /^disab/i],
  ['Roaming Aggressiveness', /lowest/i],
  ['MIMO Power Save Mode', /no smps/i],
  ['U-APSD support', /^disab/i],
  ['Throughput Booster', /^enab/i],
  ['Packet Coalescing', /^disab/i],
  // Lower latency for a little more CPU - the usual trade for a desktop.
  ['Interrupt Moderation', /^disab/i],
  ['Receive Buffers', 'max'],
  ['Transmit Buffers', 'max'],
]

export interface RawAdapter {
  Name?: string
  InterfaceDescription?: string
  Status?: string
  LinkSpeed?: string
  PhysicalMediaType?: string
}

export interface ParsedAdapter {
  name: string
  description: string
  kind: AdapterKind
  status: AdapterStatus
  speed: string
}

export interface DriverProperty {
  DisplayName?: string | null
  DisplayValue?: string | null
  ValidDisplayValues?: string[] | string | null
  NumericParameterMaxValue?: number | null
}

export interface BoostChange {
  setting: string
  from: string
  to: string
}

/** PowerShell collapses a one-element array to a bare object; undo that. */
function asList<T>(json: string): T[] {
  const text = json.trim()
  if (!text) return []
  const data = JSON.parse(text) as T | T[]
  return Array.isArray(data) ? data : [data]
}

export function parseAdapters(json: string): ParsedAdapter[] {
  return asList<RawAdapter>(json)
    .filter((r) => r.Name)
    .map((r) => {
      const description = r.InterfaceDescription ?? ''
      const wifi =
        /802\.11/.test(r.PhysicalMediaType ?? '') || /wi-?fi|wireless/i.test(description)
      const status: AdapterStatus =
        r.Status === 'Up' ? 'up' : r.Status === 'Disabled' ? 'disabled' : 'disconnected'
      return {
        name: r.Name as string,
        description,
        kind: wifi ? 'wifi' : 'ethernet',
        status,
        speed: status === 'up' ? (r.LinkSpeed ?? '') : '',
      }
    })
}

/** The settings that exist, differ from the target, and have a valid target. */
export function planBoost(props: DriverProperty[]): BoostChange[] {
  const byName = new Map<string, DriverProperty>()
  for (const p of props) if (p.DisplayName) byName.set(p.DisplayName.toLowerCase(), p)

  const plan: BoostChange[] = []
  for (const [setting, want] of BOOST_RULES) {
    const p = byName.get(setting.toLowerCase())
    if (!p || p.DisplayValue == null) continue

    let to: string | undefined
    if (want === 'max') {
      if (p.NumericParameterMaxValue != null) to = String(p.NumericParameterMaxValue)
    } else {
      const valid = Array.isArray(p.ValidDisplayValues)
        ? p.ValidDisplayValues
        : p.ValidDisplayValues
          ? [p.ValidDisplayValues]
          : []
      to = valid.find((v) => want.test(v))
    }
    if (to !== undefined && to !== p.DisplayValue) {
      plan.push({ setting: p.DisplayName as string, from: p.DisplayValue, to })
    }
  }
  return plan
}

function applyScript(
  name: string,
  changes: ReadonlyArray<readonly [string, string]>,
  powerCmd: string,
): string {
  const n = q(name)
  const lines = ['$bad = 0']
  for (const [setting, value] of changes) {
    // -NoRestart so the adapter bounces once at the end, not once per setting.
    lines.push(
      `try { Set-NetAdapterAdvancedProperty -Name ${n} -DisplayName ${q(setting)} ` +
        `-DisplayValue ${q(value)} -NoRestart -ErrorAction Stop } catch { $bad++ }`,
    )
  }
  lines.push(`try { ${powerCmd} -Name ${n} -ErrorAction Stop } catch { }`)
  lines.push(`try { Restart-NetAdapter -Name ${n} -ErrorAction Stop } catch { $bad++ }`)
  lines.push('if ($bad -gt 0) { exit 2 }; exit 0')
  return lines.join('\n')
}

export const boostScript = (name: string, plan: BoostChange[]): string =>
  applyScript(name, plan.map((c) => [c.setting, c.to]), 'Disable-NetAdapterPowerManagement')

export const revertScript = (name: string, saved: ReadonlyArray<readonly [string, string]>): string =>
  applyScript(name, saved, 'Enable-NetAdapterPowerManagement')

export const toggleScript = (name: string, enable: boolean): string =>
  `${enable ? 'Enable' : 'Disable'}-NetAdapter -Name ${q(name)} -Confirm:$false -ErrorAction Stop`

async function powershellJson(script: string): Promise<string> {
  const { code, stdout, stderr } = await powershell(
    `[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`,
    20_000,
  )
  if (code !== 0) throw new Error(stderr.trim() || 'PowerShell a eșuat')
  return stdout
}

/** Physical adapters only - TAP and VPN virtual ones are not worth a card. */
export async function listAdapters(): Promise<ParsedAdapter[]> {
  return parseAdapters(
    await powershellJson(
      'Get-NetAdapter -Physical | Select-Object Name,InterfaceDescription,Status,' +
        'LinkSpeed,PhysicalMediaType | ConvertTo-Json -Compress',
    ),
  )
}

export async function readBoostPlan(name: string): Promise<BoostChange[]> {
  return planBoost(
    asList<DriverProperty>(
      await powershellJson(
        `Get-NetAdapterAdvancedProperty -Name ${q(name)} | Select-Object DisplayName,` +
          'DisplayValue,ValidDisplayValues,NumericParameterMaxValue | ConvertTo-Json -Compress',
      ),
    ),
  )
}

/**
 * Run a PowerShell script elevated and hidden: one UAC prompt, no console
 * window. Judged by exit code, since output cannot cross the elevation
 * boundary. `declined` is true when the prompt was dismissed.
 */
export async function runElevatedPs(
  script: string,
): Promise<{ ok: boolean; declined: boolean; code: number | null }> {
  const inner = `$ErrorActionPreference='Stop';${script}`
  const outer =
    'try { ' +
    `$p = Start-Process powershell -ArgumentList '-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${encode(inner)}' ` +
    '-Verb RunAs -Wait -PassThru; exit $p.ExitCode } ' +
    `catch { exit ${UAC_DECLINED} }`
  const { code } = await powershell(outer, 90_000)
  return { ok: code === 0, declined: code === UAC_DECLINED, code }
}
