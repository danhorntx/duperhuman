/**
 * Contact extraction & ranking. Pulls a deduplicated, frequency-ranked list
 * of email senders/recipients from the local Dexie cache to power the
 * `from:` autocomplete suggestions.
 */
import { db } from '@/db/db'
import type { EmailAddress } from '@/types/email'

export interface RankedContact extends EmailAddress {
  count: number      // # of times this address has appeared
  last:  number      // most recent appearance (unix ms)
}

let cache:    RankedContact[] | null = null
let cacheTs:  number = 0
const CACHE_TTL = 30_000

export async function getContacts(accountId: string | null = null): Promise<RankedContact[]> {
  if (cache && Date.now() - cacheTs < CACHE_TTL) return cache

  const rows = accountId
    ? await db.emails.where('accountId').equals(accountId).toArray()
    : await db.emails.toArray()

  const map = new Map<string, RankedContact>()
  const ingest = (a: EmailAddress | undefined, ts: number) => {
    if (!a?.address) return
    const key = a.address.toLowerCase()
    const cur = map.get(key)
    if (cur) {
      cur.count += 1
      if (ts > cur.last) cur.last = ts
      if (!cur.name && a.name) cur.name = a.name
    } else {
      map.set(key, { name: a.name || '', address: a.address, count: 1, last: ts })
    }
  }

  for (const e of rows) {
    ingest(e.from, e.date)
    e.to.forEach(a => ingest(a, e.date))
    e.cc.forEach(a => ingest(a, e.date))
  }

  cache = [...map.values()].sort(
    (a, b) => b.count - a.count || b.last - a.last,
  )
  cacheTs = Date.now()
  return cache
}

export function invalidateContactCache() {
  cache = null
}

export function filterContacts(contacts: RankedContact[], q: string, limit = 8): RankedContact[] {
  if (!q) return contacts.slice(0, limit)
  const needle = q.toLowerCase()
  return contacts
    .filter(c =>
      c.address.toLowerCase().includes(needle) ||
      c.name.toLowerCase().includes(needle),
    )
    .slice(0, limit)
}
