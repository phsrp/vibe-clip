// Simple logger: prints to the terminal and appends to a log file in the app's data folder.
// Every module logs through here so problems are never silent.
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

type Level = 'info' | 'warn' | 'error'

let logFile: string | null = null

export function logPath(): string {
  if (!logFile) {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'app.log')
  }
  return logFile
}

function write(level: Level, scope: string, message: string, extra?: unknown): void {
  const time = new Date().toISOString()
  let line = `${time} [${level.toUpperCase()}] [${scope}] ${message}`
  if (extra !== undefined) {
    line += ' ' + (extra instanceof Error ? extra.stack || extra.message : safeJson(extra))
  }
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  out(line)
  try {
    fs.appendFileSync(logPath(), line + '\n')
  } catch {
    // If the log file can't be written there's nowhere else to report it.
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createLogger(scope: string) {
  return {
    info: (msg: string, extra?: unknown) => write('info', scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write('warn', scope, msg, extra),
    error: (msg: string, extra?: unknown) => write('error', scope, msg, extra)
  }
}
