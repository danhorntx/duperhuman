import MiniSearch from 'minisearch'
import type { Email } from '@/types/email'

// ─── Local full-text index (MiniSearch / IndexedDB-backed) ───────────────────

interface SearchDoc {
  id: string
  subject: string
  fromName: string
  fromAddress: string
  snippet: string
  bodyText: string
  labels: string
}

const miniSearch = new MiniSearch<SearchDoc>({
  fields: ['subject', 'fromName', 'fromAddress', 'snippet', 'bodyText', 'labels'],
  storeFields: ['id'],
  searchOptions: {
    boost: { subject: 3, fromName: 2, fromAddress: 1.5 },
    fuzzy: 0.2,
    prefix: true,
  },
})

// Track indexed ids to avoid duplicates
const indexedIds = new Set<string>()
const indexedDocs = new Map<string, SearchDoc>()

function toDoc(email: Email): SearchDoc {
  return {
    id: email.id,
    subject: email.subject,
    fromName: email.from.name,
    fromAddress: email.from.address,
    snippet: email.snippet,
    bodyText: email.bodyText.slice(0, 2000),
    labels: email.labels.join(' '),
  }
}

export function buildIndex(emails: Email[]) {
  const newEmails = emails.filter(e => !indexedIds.has(e.id))
  if (newEmails.length === 0) return
  const docs = newEmails.map(toDoc)
  miniSearch.addAll(docs)
  docs.forEach(doc => {
    indexedIds.add(doc.id)
    indexedDocs.set(doc.id, doc)
  })
}

export function addToIndex(email: Email) {
  if (indexedIds.has(email.id)) {
    const doc = indexedDocs.get(email.id)
    if (doc) miniSearch.remove(doc)
    indexedIds.delete(email.id)
    indexedDocs.delete(email.id)
  }
  const doc = toDoc(email)
  miniSearch.add(doc)
  indexedIds.add(email.id)
  indexedDocs.set(email.id, doc)
}

export function removeFromIndex(id: string) {
  if (!indexedIds.has(id)) return
  try {
    const doc = indexedDocs.get(id)
    if (doc) miniSearch.remove(doc)
  } catch {
    // not present — safe to ignore
  }
  indexedIds.delete(id)
  indexedDocs.delete(id)
}

export function localSearch(query: string, limit = 20): string[] {
  if (!query.trim()) return []
  return miniSearch
    .search(query)
    .slice(0, limit)
    .map(r => r.id as string)
}

export function clearIndex() {
  miniSearch.removeAll()
  indexedIds.clear()
  indexedDocs.clear()
}
