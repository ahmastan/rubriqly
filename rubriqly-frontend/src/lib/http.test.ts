import { describe, expect, it } from 'vitest'
import { safeNext } from './auth'
import { ApiError, apiFetch } from './http'
import { fakeBackend } from '../test/fakeBackend'

describe('apiFetch', () => {
  it('turns the backend’s errors into ApiError with its code and message', async () => {
    fakeBackend.signOut()
    const error = await apiFetch('/api/auth/me').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, code: 'not_signed_in' })
  })

  it('explains when the server can’t be reached', async () => {
    fakeBackend.goOffline()
    await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({
      code: 'network',
      message: expect.stringContaining('Can’t reach Rubriqly'),
    })
  })

  it('treats a web page instead of data as the server being unreachable', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () =>
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    try {
      await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({
        code: 'network',
        message: expect.stringContaining('Can’t reach Rubriqly'),
      })
    } finally {
      globalThis.fetch = original
    }
  })

  it('gives validation errors a friendly message', async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: [{ loc: ['body'], msg: 'bad' }] }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    try {
      await expect(apiFetch('/api/checks', { method: 'POST', body: {} })).rejects.toMatchObject({
        status: 422,
        message: 'Some of the details aren’t valid. Check them and try again.',
      })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('errors without the backend’s details', () => {
  it.each([
    [502, 'Rubriqly’s server is starting up or busy. Please try again in a minute.'],
    [504, 'Rubriqly’s server is starting up or busy. Please try again in a minute.'],
    [413, 'That’s too large to send. Try a smaller file or photo.'],
    [500, 'Something went wrong on our side. Please try again in a minute.'],
  ])('%i gets a message that says what to do', async (status, message) => {
    const original = globalThis.fetch
    globalThis.fetch = async () => new Response('Bad Gateway', { status })
    try {
      await expect(
        apiFetch('/api/rubric-scans', { method: 'POST', body: {} }),
      ).rejects.toMatchObject({ status, code: `http_${status}`, message })
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('safeNext', () => {
  it('only allows paths on this site', () => {
    expect(safeNext('/checks/chk_1?x=1')).toBe('/checks/chk_1?x=1')
    expect(safeNext(null)).toBe('/check/new')
    expect(safeNext('https://evil.example')).toBe('/check/new')
    expect(safeNext('//evil.example')).toBe('/check/new')
    expect(safeNext('/\\evil.example')).toBe('/check/new')
  })
})
