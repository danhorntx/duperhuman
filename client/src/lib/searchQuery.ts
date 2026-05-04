/**
 * Search query parser — extracts structured operators (`from:`, `in:`) from a
 * free-text query and returns the structured form plus the residual free-text.
 *
 * Examples:
 *   parseQuery('from:alice@x.com invoice')
 *     → { operators: { from: 'alice@x.com' }, freeText: 'invoice' }
 *
 *   parseQuery('in:sent from:bob@x.com Q4 report')
 *     → { operators: { in: 'sent', from: 'bob@x.com' }, freeText: 'Q4 report' }
 *
 *   parseQuery('in:"Big Clients" budget')
 *     → { operators: { in: 'Big Clients' }, freeText: 'budget' }
 */

import type { Email } from '@/types/email'

export interface ParsedQuery {
  operators: {
    from?: string
    in?:   string
  }
  freeText: string
  raw:     string
}

const OPERATOR_RE = /\b(from|in):(?:"([^"]*)"|(\S+))/gi

export function parseQuery(raw: string): ParsedQuery {
  const operators: ParsedQuery['operators'] = {}
  let stripped = raw

  for (const match of raw.matchAll(OPERATOR_RE)) {
    const op    = match[1].toLowerCase() as 'from' | 'in'
    const value = match[2] ?? match[3] ?? ''
    if (value) operators[op] = value
    stripped = stripped.replace(match[0], '')
  }

  return {
    operators,
    freeText: stripped.replace(/\s+/g, ' ').trim(),
    raw,
  }
}

/**
 * Detect whether the cursor is inside an unfinished operator value, so the
 * autocomplete dropdown knows to surface contact / folder suggestions.
 *
 * Returns either:
 *   - { operator: 'from', partial: 'jo', start: 12 } — user is typing after `from:jo`
 *   - { operator: 'in',   partial: '',   start: 9  } — user just typed `in:`
 *   - null — not inside any operator value
 */
export interface ActiveOperator {
  operator: 'from' | 'in'
  partial:  string
  start:    number    // index of the operator keyword in the raw string
  end:      number    // index past the partial value
}

export function getActiveOperator(raw: string, cursor: number): ActiveOperator | null {
  // Look backward from cursor for the most recent `from:` or `in:` that the
  // cursor sits inside.
  const slice = raw.slice(0, cursor)
  const m = slice.match(/(?:^|\s)(from|in):([^\s"]*)$/i)
  if (!m) return null

  const operator = m[1].toLowerCase() as 'from' | 'in'
  const partial  = m[2] ?? ''
  const start    = cursor - m[0].trimStart().length
  return { operator, partial, start, end: cursor }
}

/**
 * Run a ParsedQuery against a list of Email objects. Used both by the live
 * inline search popup and the full search results view.
 */
export function filterEmailsByQuery(
  emails: Email[],
  query:  ParsedQuery,
  folderResolver?: (folderToken: string) => (e: Email) => boolean,
): Email[] {
  const { operators, freeText } = query
  const ftLower = freeText.toLowerCase()

  return emails.filter(e => {
    if (operators.from) {
      const needle = operators.from.toLowerCase()
      const hay    = `${e.from.address} ${e.from.name}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }

    if (operators.in) {
      const folderTest = folderResolver?.(operators.in)
      if (folderTest) {
        if (!folderTest(e)) return false
      } else {
        // fallback: match folder name OR a label string
        const tok = operators.in.toLowerCase()
        const matchesFolder = e.folder.toLowerCase() === tok
        const matchesLabel  = e.labels.some(l => l.toLowerCase() === tok)
        if (!matchesFolder && !matchesLabel) return false
      }
    }

    if (ftLower) {
      const hay = `${e.subject} ${e.from.name} ${e.from.address} ${e.snippet} ${e.bodyText}`
        .toLowerCase()
      if (!hay.includes(ftLower)) return false
    }

    return true
  })
}
