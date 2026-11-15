import type { Assignment, CheckResult, Draft, Rubric } from './types'

// Drafts stay on this device: assignments, drafts, check results and the rubrics a student
// creates live in the browser's localStorage. Only the text being checked leaves the
// device, sent to the backend for scoring. Storage can be unavailable (private windows, blocked
// site data), so every access is guarded and falls back to memory for the current tab.
//
// Each account has its own key (`rubriqly:v1:<user id>`), so two people sharing a computer don't
// see each other's drafts. The signed-in account is set with `setStorageUser`.

const LEGACY_KEY = 'rubriqly:v1'
const keyFor = (userId: string) => `${LEGACY_KEY}:${userId}`

export interface LocalData {
  assignments: Assignment[]
  drafts: Draft[]
  checks: CheckResult[]
  rubrics: Rubric[]
}

const empty = (): LocalData => ({ assignments: [], drafts: [], checks: [], rubrics: [] })

let currentUser: string | null = null
const memory = new Map<string, LocalData>()

/**
 * Switch storage to this account (or to none when signed out). The first account to sign in on
 * a browser takes over drafts saved there before accounts existed.
 */
export function setStorageUser(userId: string | null): void {
  if (userId === currentUser) return
  currentUser = userId
  if (!userId) return
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy !== null && localStorage.getItem(keyFor(userId)) === null) {
      localStorage.setItem(keyFor(userId), legacy)
    }
    if (legacy !== null) localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Storage blocked: nothing to move.
  }
}

export function getStorageUser(): string | null {
  return currentUser
}

/** Where unreadable saved data is moved (one key per time it happens), so it isn't overwritten. */
const damagedPrefix = (userId: string) => `${keyFor(userId)}:damaged:`

/** Thrown when the browser refuses to save because its storage for this site is full. */
export class StorageFullError extends Error {
  constructor() {
    super(
      'Your browser’s storage for Rubriqly is full, so this couldn’t be saved. Delete old drafts or assignments to free space.',
    )
    this.name = 'StorageFullError'
  }
}

/** Thrown when saving would overwrite earlier data this browser couldn't read or copy. */
export class DamagedStorageError extends Error {
  constructor() {
    super(
      'Rubriqly couldn’t read what this browser saved earlier and has no room to keep a copy, so it won’t save over it. Use “Export my data” in Settings to keep a copy, then “Delete all data” to start fresh.',
    )
    this.name = 'DamagedStorageError'
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  )
}

function parse(raw: string): LocalData | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const data = { ...empty(), ...(parsed as Partial<LocalData>) }
    const lists = [data.assignments, data.drafts, data.checks, data.rubrics]
    return lists.every(Array.isArray) ? data : undefined
  } catch {
    return undefined
  }
}

// Accounts whose unreadable data couldn't be moved aside: saving would overwrite it.
const stuckDamaged = new Set<string>()
// Accounts whose writes are refused for good (storage blocked): this tab's memory is the truth.
const memoryOnly = new Set<string>()

/** Move unreadable data aside so it can still be exported, instead of overwriting it. */
function setAsideDamaged(userId: string, raw: string): void {
  try {
    const base = `${damagedPrefix(userId)}${Date.now()}`
    let key = base
    for (let i = 2; localStorage.getItem(key) !== null; i++) key = `${base}_${i}`
    localStorage.setItem(key, raw)
    localStorage.removeItem(keyFor(userId))
    stuckDamaged.delete(userId)
  } catch {
    stuckDamaged.add(userId)
  }
}

export function loadData(): LocalData {
  if (!currentUser) return empty()
  if (memoryOnly.has(currentUser)) return memory.get(currentUser) ?? empty()
  let raw: string | null
  try {
    raw = localStorage.getItem(keyFor(currentUser))
  } catch {
    // Storage blocked: use this tab's in-memory copy.
    return memory.get(currentUser) ?? empty()
  }
  const data = raw ? parse(raw) : empty()
  if (data) {
    // Readable again (or deleted in another tab): saving is safe.
    stuckDamaged.delete(currentUser)
    return data
  }
  setAsideDamaged(currentUser, raw!)
  return empty()
}

export function saveData(data: LocalData): void {
  if (!currentUser) throw new Error('Sign in to save drafts.')
  if (stuckDamaged.has(currentUser)) throw new DamagedStorageError()
  try {
    localStorage.setItem(keyFor(currentUser), JSON.stringify(data))
    memoryOnly.delete(currentUser)
  } catch (error) {
    // Full: say so, rather than pretend it saved (the next load would read the old copy).
    // A quota error with nothing stored at all is a zero-quota private window: treat as blocked.
    if (isQuotaError(error) && originHasData()) throw new StorageFullError()
    // Blocked (private window, site data off): keep an in-memory copy for this tab, and read it
    // back until a later save gets through.
    memoryOnly.add(currentUser)
  }
  memory.set(currentUser, data)
}

export function updateData(change: (data: LocalData) => void): LocalData {
  const data = loadData()
  change(data)
  saveData(data)
  return data
}

/** Anything stored for this site (any account, or the theme), so a quota error means "full". */
function originHasData(): boolean {
  try {
    return localStorage.length > 0
  } catch {
    return false
  }
}

/**
 * Throws if about `chars` more characters (at two bytes each) can't be saved, so a paid check isn't run only to be
 * lost. Writes and removes a temporary value of that size.
 */
export function ensureRoom(chars: number): void {
  if (!currentUser) throw new Error('Sign in to save drafts.')
  if (stuckDamaged.has(currentUser)) throw new DamagedStorageError()
  const probe = `${LEGACY_KEY}:room-check`
  try {
    // A curly quote, so browsers count it at full width, as they would a pasted essay.
    localStorage.setItem(probe, '\u2019'.repeat(chars))
  } catch (error) {
    if (isQuotaError(error) && originHasData()) throw new StorageFullError()
  } finally {
    try {
      localStorage.removeItem(probe)
    } catch {
      // Blocked: nothing was written.
    }
  }
}

/** Saved data this browser couldn't read, exactly as stored, so it can be exported. */
export function loadDamagedData(): string[] {
  if (!currentUser) return []
  const found: string[] = []
  try {
    const prefix = damagedPrefix(currentUser)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) found.push(localStorage.getItem(key) ?? '')
    }
    // Still in place when there was no room to move it.
    if (stuckDamaged.has(currentUser)) found.push(localStorage.getItem(keyFor(currentUser)) ?? '')
  } catch {
    // Storage blocked: nothing stored.
  }
  return found
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${random}`
}

/** Delete everything this account stored on this device (assignments, drafts, checks, rubrics). */
export function clearData(): void {
  if (!currentUser) return
  memory.delete(currentUser)
  stuckDamaged.delete(currentUser)
  try {
    const prefix = damagedPrefix(currentUser)
    const damaged = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    damaged.filter((k) => k?.startsWith(prefix)).forEach((k) => localStorage.removeItem(k!))
    localStorage.removeItem(keyFor(currentUser))
  } catch {
    // Storage blocked: nothing was persisted.
  }
}
