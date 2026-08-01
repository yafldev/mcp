import { listTransfers, load, type TransferListItem } from '@yafl/client'
import type { CommandContext } from '../index.js'
import { AuthError } from '../errors.js'

/** Compact `123B`/`4.5KB`/`2.1MB` rendering for the table's size column. */
function formatBytes(size: number | null): string {
  if (size === null) return '-'
  if (size < 1000) return `${size}B`
  if (size < 1_000_000) return `${(size / 1000).toFixed(1)}KB`
  return `${(size / 1_000_000).toFixed(1)}MB`
}

/** Compact `2m`/`3h`/`1d` rendering, used for both the age and expires-in columns. */
function formatDuration(ms: number): string {
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatAge(createdAt: string): string {
  return `${formatDuration(Date.now() - new Date(createdAt).getTime())} ago`
}

function formatExpiresIn(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  return `in ${formatDuration(ms)}`
}

/** Right-pads `value` to `width` characters (never truncates — columns just widen). */
function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length)
}

function renderTable(items: TransferListItem[]): string {
  if (items.length === 0) return 'No transfers.'

  const headers = ['ID', 'SIZE', 'AGE', 'EXPIRES']
  const rows = items.map((item) => [
    item.id,
    formatBytes(item.size),
    formatAge(item.createdAt),
    formatExpiresIn(item.expiresAt),
  ])

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
  const renderRow = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()

  return [renderRow(headers), ...rows.map(renderRow)].join('\n')
}

/**
 * `yafl list [--json]` — lists the caller's own transfers as a table (or
 * JSON with --json). Reuses @yafl/client's listTransfers, the identical
 * capability MCP's list_files tool exposes (MCPX-03 parity).
 */
export async function runList(ctx: CommandContext): Promise<number> {
  const creds = await load({ env: ctx.env })
  if (!creds) {
    throw new AuthError('Not logged in. Run `yafl login` or set YAFL_API_KEY.')
  }

  const apiOptions = { apiUrl: ctx.apiUrl, apiKey: creds.apiKey }
  const items = await listTransfers(apiOptions)

  if (ctx.json) {
    ctx.print(JSON.stringify(items))
  } else {
    ctx.print(renderTable(items))
  }
  return 0
}
