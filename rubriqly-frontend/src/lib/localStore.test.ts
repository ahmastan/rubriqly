import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearData,
  DamagedStorageError,
  ensureRoom,
  loadDamagedData,
  loadData,
  saveData,
  setStorageUser,
  StorageFullError,
  updateData,
} from './localStore'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('localStore', () => {
  it('keeps each account’s drafts separate', () => {
    setStorageUser('usr_a')
    updateData((data) => {
      data.rubrics.push({ id: 'mine' } as never)
    })
    setStorageUser('usr_b')
    expect(loadData().rubrics).toEqual([])
    setStorageUser('usr_a')
    expect(loadData().rubrics).toHaveLength(1)
    expect(localStorage.getItem('rubriqly:v1:usr_a')).not.toBeNull()
  })

  it('gives drafts saved before accounts existed to the first account that signs in', () => {
    setStorageUser(null)
    const old = { assignments: [], drafts: [], checks: [], rubrics: [{ id: 'old' }] }
    localStorage.setItem('rubriqly:v1', JSON.stringify(old))

    setStorageUser('usr_first')
    expect(loadData().rubrics).toEqual([{ id: 'old' }])
    expect(localStorage.getItem('rubriqly:v1')).toBeNull()

    setStorageUser('usr_second')
    expect(loadData().rubrics).toEqual([])
  })

  it('stores nothing while signed out', () => {
    setStorageUser(null)
    expect(loadData().checks).toEqual([])
    expect(() => saveData(loadData())).toThrow(/Sign in/)
  })

  it('says so when storage is full, instead of pretending it saved', () => {
    setStorageUser('usr_full')
    updateData((data) => {
      data.rubrics.push({ id: 'kept' } as never)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() =>
      updateData((data) => {
        data.rubrics.push({ id: 'new' } as never)
      }),
    ).toThrow(StorageFullError)
    expect(loadData().rubrics).toEqual([{ id: 'kept' }])
  })

  it('still works for this tab when storage is blocked', () => {
    setStorageUser('usr_blocked')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    updateData((data) => {
      data.rubrics.push({ id: 'in-memory' } as never)
    })
    expect(loadData().rubrics).toEqual([{ id: 'in-memory' }])
  })

  it('keeps unreadable data aside instead of overwriting it', () => {
    setStorageUser('usr_damaged')
    localStorage.setItem('rubriqly:v1:usr_damaged', '{"checks": [oops')
    expect(loadData().checks).toEqual([])

    updateData((data) => {
      data.rubrics.push({ id: 'fresh' } as never)
    })
    expect(loadData().rubrics).toEqual([{ id: 'fresh' }])
    expect(loadDamagedData()).toEqual(['{"checks": [oops'])

    // A second time keeps both copies.
    localStorage.setItem('rubriqly:v1:usr_damaged', 'broken again')
    expect(loadData().rubrics).toEqual([])
    expect(loadDamagedData()).toEqual(['{"checks": [oops', 'broken again'])

    clearData()
    expect(loadDamagedData()).toEqual([])
    expect(Object.keys(localStorage).filter((k) => k.includes('usr_damaged'))).toEqual([])
  })

  it('treats saved data of the wrong shape as damaged', () => {
    setStorageUser('usr_shape')
    localStorage.setItem('rubriqly:v1:usr_shape', '{"checks": "not a list"}')
    expect(loadData().checks).toEqual([])
    expect(loadDamagedData()).toEqual(['{"checks": "not a list"}'])
  })

  it('refuses to save over unreadable data it couldn’t move aside', () => {
    setStorageUser('usr_stuck')
    localStorage.setItem('rubriqly:v1:usr_stuck', 'not json')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    loadData()
    expect(() => updateData(() => {})).toThrow(DamagedStorageError)
    expect(() => ensureRoom(10)).toThrow(DamagedStorageError)
    expect(loadDamagedData()).toEqual(['not json'])
    vi.restoreAllMocks()
    expect(localStorage.getItem('rubriqly:v1:usr_stuck')).toBe('not json')
  })

  it('counts storage filled by another account as full', () => {
    setStorageUser('usr_other')
    updateData((data) => {
      data.rubrics.push({ id: 'theirs' } as never)
    })
    setStorageUser('usr_new')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => ensureRoom(1000)).toThrow(StorageFullError)
    expect(() => updateData(() => {})).toThrow(StorageFullError)
  })

  it('saves again once unreadable data is gone', () => {
    setStorageUser('usr_recovers')
    localStorage.setItem('rubriqly:v1:usr_recovers', 'not json')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    loadData()
    expect(() => updateData(() => {})).toThrow(DamagedStorageError)
    setItem.mockRestore()
    localStorage.removeItem('rubriqly:v1:usr_recovers') // "Delete all data" in another tab
    expect(() => updateData(() => {})).not.toThrow()
  })

  it('goes back to storage when a blocked write later succeeds', () => {
    setStorageUser('usr_flaky')
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    updateData((data) => {
      data.rubrics.push({ id: 'one' } as never)
    })
    setItem.mockRestore()
    updateData((data) => {
      data.rubrics.push({ id: 'two' } as never)
    })
    expect(JSON.parse(localStorage.getItem('rubriqly:v1:usr_flaky')!).rubrics).toHaveLength(2)
  })

  it('treats a zero-quota private window as blocked, not full', () => {
    setStorageUser('usr_private')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('no quota', 'QuotaExceededError')
    })
    expect(() => ensureRoom(1000)).not.toThrow()
    updateData((data) => {
      data.rubrics.push({ id: 'tab-only' } as never)
    })
    expect(loadData().rubrics).toEqual([{ id: 'tab-only' }])
  })

  it('reads back this tab’s saves when only writing is blocked', () => {
    setStorageUser('usr_readonly')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    updateData((data) => {
      data.rubrics.push({ id: 'in-memory' } as never)
    })
    expect(loadData().rubrics).toEqual([{ id: 'in-memory' }])
  })

  it('checks for room before a check is run', () => {
    setStorageUser('usr_room')
    updateData(() => {})
    expect(() => ensureRoom(1000)).not.toThrow()
    expect(Object.keys(localStorage).some((k) => k.includes('room-check'))).toBe(false)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => ensureRoom(1000)).toThrow(StorageFullError)
  })
})
