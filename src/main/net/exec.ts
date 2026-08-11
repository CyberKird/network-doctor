import { spawn } from 'node:child_process'

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Run a shell command and capture its output.
 *
 * Everything this app runs is a fixed command string from `capabilities.ts`;
 * the only values that ever come from outside are an interface name and a DNS
 * address, and both are validated at the boundary before they get here. Keep
 * it that way - `shell: true` means anything interpolated in is executed.
 */
export function run(command: string, timeoutMs = 15_000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true, // no console flash on Windows
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (code: number | null, killed = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: !killed && code === 0,
        stdout,
        stderr: killed ? `${stderr}\n[timed out after ${timeoutMs}ms]`.trim() : stderr,
        code,
      })
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(null, true)
    }, timeoutMs)

    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      stderr += err.message
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/**
 * Run a command with administrator/root rights.
 *
 * Each platform has exactly one sanctioned way to ask, and all three show the
 * OS's own consent dialog - we never take a password ourselves.
 */
export function runElevated(command: string, timeoutMs = 60_000): Promise<ExecResult> {
  switch (process.platform) {
    case 'win32': {
      // Start-Process -Verb RunAs triggers the UAC prompt. -Wait so we know
      // when it finished; the inner command's own output is not retrievable
      // across the elevation boundary, so success is judged by exit code.
      const inner = command.replace(/"/g, '\\"')
      return run(
        `powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c ${inner}' -Verb RunAs -WindowStyle Hidden -Wait"`,
        timeoutMs,
      )
    }
    case 'darwin': {
      // osascript shows the standard macOS authentication dialog.
      const inner = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return run(
        `osascript -e 'do shell script "${inner}" with administrator privileges'`,
        timeoutMs,
      )
    }
    default: {
      // pkexec is the polkit prompt present on mainstream desktop Linux.
      return run(`pkexec sh -c ${shellQuote(command)}`, timeoutMs)
    }
  }
}

/** Single-quote a string for POSIX sh. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Interface names and DNS servers are the only values that reach a command
 * line from outside a constant, so they are checked rather than escaped -
 * a name that does not look like an interface is a bug, not something to
 * quote around.
 */
export function isSafeInterfaceName(name: string): boolean {
  return /^[A-Za-z0-9 _.\-#()]{1,64}$/.test(name)
}

export function isIpAddress(value: string): boolean {
  const parts = value.split('.')
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255)
  )
}
