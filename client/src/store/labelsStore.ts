import { create } from 'zustand'
import { db } from '@/db/db'
import { applyRulesToBatch, emailMatchesLabel } from '@/lib/ruleEngine'
import { generateId } from '@/lib/utils'
import type { CustomLabel, Email, LabelRule, RuleConjunction } from '@/types/email'

interface LabelsStore {
  labels:    CustomLabel[]
  isLoading: boolean

  load:      () => Promise<void>
  create:    (input: Omit<CustomLabel, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CustomLabel>
  update:    (id: string, patch: Partial<Omit<CustomLabel, 'id' | 'createdAt'>>) => Promise<void>
  remove:    (id: string) => Promise<void>
  rename:    (id: string, name: string) => Promise<void>

  // Re-run rules on the entire local cache (with progress callback)
  applyRulesBulk: (labelId?: string, onProgress?: (pct: number) => void) => Promise<number>

  // Apply rules to a single fresh email (called from emailStore on sync)
  tagEmail:  (email: Email) => Email
}

export const useLabelsStore = create<LabelsStore>((set, get) => ({
  labels:    [],
  isLoading: false,

  load: async () => {
    set({ isLoading: true })
    const labels = await db.labels.orderBy('updatedAt').reverse().toArray()
    set({ labels, isLoading: false })
  },

  create: async (input) => {
    const now = Date.now()
    const label: CustomLabel = {
      ...input,
      id:        generateId(),
      createdAt: now,
      updatedAt: now,
    }
    await db.labels.put(label)
    set(s => ({ labels: [label, ...s.labels] }))
    return label
  },

  update: async (id, patch) => {
    const updatedAt = Date.now()
    await db.labels.update(id, { ...patch, updatedAt })
    set(s => ({
      labels: s.labels.map(l => (l.id === id ? { ...l, ...patch, updatedAt } : l)),
    }))
  },

  remove: async (id) => {
    await db.labels.delete(id)
    // Strip the label off any tagged emails
    const emails = await db.emails.filter(e => e.labels.includes(id)).toArray()
    if (emails.length > 0) {
      await db.emails.bulkPut(
        emails.map(e => ({ ...e, labels: e.labels.filter(l => l !== id) })),
      )
    }
    set(s => ({ labels: s.labels.filter(l => l.id !== id) }))
  },

  rename: async (id, name) => {
    return get().update(id, { name })
  },

  applyRulesBulk: async (labelId, onProgress) => {
    const labelsAll = get().labels
    const labels = labelId ? labelsAll.filter(l => l.id === labelId) : labelsAll
    if (labels.length === 0) return 0

    const all      = await db.emails.toArray()
    const total    = all.length
    let   tagged   = 0
    const batchSz  = 200

    for (let i = 0; i < total; i += batchSz) {
      const batch  = all.slice(i, i + batchSz)
      const matches = applyRulesToBatch(batch, labels)
      const updates: Email[] = []
      for (const e of batch) {
        const newIds = matches.get(e.id) ?? []
        if (newIds.length === 0) continue
        const merged = Array.from(new Set([...e.labels, ...newIds]))
        if (merged.length !== e.labels.length) {
          updates.push({ ...e, labels: merged })
          tagged += 1
        }
      }
      if (updates.length > 0) await db.emails.bulkPut(updates)
      onProgress?.(Math.min(100, Math.round(((i + batchSz) / total) * 100)))
    }
    onProgress?.(100)
    return tagged
  },

  tagEmail: (email) => {
    const labels = get().labels
    if (labels.length === 0) return email
    const ids = labels
      .filter(l => (l.accountId === '*' || l.accountId === email.accountId))
      .filter(l => emailMatchesLabel(email, l))
      .map(l => l.id)
    if (ids.length === 0) return email
    const merged = Array.from(new Set([...email.labels, ...ids]))
    if (merged.length === email.labels.length) return email
    return { ...email, labels: merged }
  },
}))

// ─── Helpers exposed for callers ──────────────────────────────────────────────

export function emptyRule(): LabelRule {
  return { id: generateId(), field: 'from', operator: 'contains', value: '' }
}

export function defaultLabelInput(accountId: string): Omit<CustomLabel, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    accountId,
    name:        'New label',
    color:       '#cbb7fb',
    rules:       [emptyRule()],
    conjunction: 'AND' as RuleConjunction,
  }
}
