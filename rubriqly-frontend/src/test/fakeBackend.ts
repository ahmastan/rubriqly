import { mockCheckResponse } from '../lib/mockJev'
import type { Rubric, ScannedRubric } from '../lib/types'

// A stand-in for the Rubriqly backend, installed as `fetch` for every test (see setup.ts).
// It follows the real API's shapes and error format (`{detail: {code, message}}`), keeps
// accounts in memory, and scores checks with the deterministic mock scorer.

export const TEST_PASSWORD = 'maple river quiet lamp'

interface FakeAccount {
  id: string
  email: string
  display_name: string
  created_at: string
  password: string
}

const TEST_ACCOUNT: FakeAccount = {
  id: 'usr_test1',
  email: 'test1@rubriqly.com',
  display_name: 'Test Student One',
  created_at: '2026-09-23T12:00:00Z',
  password: TEST_PASSWORD,
}

export interface RecordedRequest {
  method: string
  path: string
  body: unknown
}

type Reply = { status: number; body?: unknown }

let accounts: FakeAccount[] = []
let signedIn: FakeAccount | null = null
let nextCheckReply: Reply | null = null
let offline = false
let scansUsed = 0
let scanningAvailable = true
let nextScanReply: Reply | null = null
const SCAN_LIMIT = 5
const NEXT_FREE_AT = '2026-09-30T15:05:00Z'
let held: Promise<void> | null = null
export const requests: RecordedRequest[] = []

/** Back to one account (test1@rubriqly.com), signed in. */
export function resetFakeBackend({ signedIn: startSignedIn = true } = {}) {
  accounts = [{ ...TEST_ACCOUNT }]
  signedIn = startSignedIn ? accounts[0] : null
  nextCheckReply = null
  offline = false
  scansUsed = 0
  scanningAvailable = true
  nextScanReply = null
  held = null
  requests.length = 0
}

export const fakeBackend = {
  signOut: () => {
    signedIn = null
  },
  addAccount: (email: string, displayName: string, id = `usr_${accounts.length + 1}`) => {
    accounts.push({ ...TEST_ACCOUNT, id, email, display_name: displayName })
  },
  /** The next POST /api/checks fails like this, e.g. 503 scoring_unavailable. */
  failNextCheck: (status: number, code: string, message: string) => {
    nextCheckReply = { status, body: { detail: { code, message } } }
  },
  /** Replies wait (like a sleeping server) until the returned function is called. */
  holdReplies: () => {
    let release = () => {}
    held = new Promise<void>((resolve) => (release = resolve))
    return () => {
      held = null
      release()
    }
  },
  /** The next POST /api/rubric-scans fails like this, e.g. 422 scan_unreadable. */
  failNextScan: (status: number, code: string, message: string) => {
    nextScanReply = { status, body: { detail: { code, message } } }
  },
  /** Like a production server where scanning isn't switched on. */
  disableScanning: () => {
    scanningAvailable = false
  },
  /** How many of this week's scans are used (the limit is 5). */
  setScansUsed: (used: number) => {
    scansUsed = used
  },
  goOffline: () => {
    offline = true
  },
  isSignedIn: () => signedIn !== null,
}

const out = (a: FakeAccount) => ({
  id: a.id,
  email: a.email,
  display_name: a.display_name,
  created_at: a.created_at,
})
const error = (status: number, code: string, message: string): Reply => ({
  status,
  body: { detail: { code, message } },
})
const notSignedIn = () => error(401, 'not_signed_in', 'Please sign in to continue.')

function handle(method: string, path: string, body: Record<string, unknown>): Reply {
  if (method === 'GET' && path === '/api/auth/me') {
    return signedIn ? { status: 200, body: out(signedIn) } : notSignedIn()
  }
  if (method === 'POST' && path === '/api/auth/login') {
    const email = String(body.email).trim().toLowerCase()
    const account = accounts.find((a) => a.email === email && a.password === body.password)
    if (!account) return error(401, 'invalid_credentials', 'Email or password is incorrect.')
    signedIn = account
    return { status: 200, body: out(account) }
  }
  if (method === 'POST' && path === '/api/auth/signup') {
    if (!body.confirms_age) {
      return error(400, 'must_confirm_age', 'You must be 13 or older to use Rubriqly.')
    }
    const email = String(body.email).trim().toLowerCase()
    if (accounts.some((a) => a.email === email)) {
      return error(409, 'email_taken', 'That email already has an account. Sign in?')
    }
    if (String(body.password).length < 12) {
      return error(400, 'weak_password', 'Use at least 12 characters.')
    }
    const account = {
      id: `usr_${accounts.length + 1}`,
      email,
      display_name: String(body.display_name),
      created_at: '2026-09-23T12:00:00Z',
      password: String(body.password),
    }
    accounts.push(account)
    signedIn = account
    return { status: 201, body: out(account) }
  }
  if (method === 'POST' && path === '/api/auth/logout') {
    signedIn = null
    return { status: 204 }
  }
  if (!signedIn) return notSignedIn()
  if (method === 'PATCH' && path === '/api/auth/me') {
    signedIn.display_name = String(body.display_name).trim()
    return { status: 200, body: out(signedIn) }
  }
  if (method === 'POST' && path === '/api/auth/password') {
    if (body.current_password !== signedIn.password) {
      return error(400, 'wrong_password', 'Your current password is incorrect.')
    }
    signedIn.password = String(body.new_password)
    return { status: 204 }
  }
  if (method === 'DELETE' && path === '/api/auth/me') {
    if (body.password !== signedIn.password) {
      return error(400, 'wrong_password', 'Your password is incorrect.')
    }
    accounts = accounts.filter((a) => a !== signedIn)
    signedIn = null
    return { status: 204 }
  }
  if (method === 'POST' && path === '/api/checks') {
    if (nextCheckReply) {
      const reply = nextCheckReply
      nextCheckReply = null
      return reply
    }
    const response = mockCheckResponse(body.rubric as Rubric, String(body.text))
    return { status: 200, body: { ...response, model: 'typesafe-ai/jev' } }
  }
  if (method === 'GET' && path === '/api/rubric-scans/quota') {
    return { status: 200, body: scanQuota() }
  }
  if (method === 'POST' && path === '/api/rubric-scans') {
    if (nextScanReply) {
      const reply = nextScanReply
      nextScanReply = null
      return reply
    }
    if (scansUsed >= SCAN_LIMIT) {
      return error(
        429,
        'weekly_scan_limit',
        `You've used your ${SCAN_LIMIT} rubric scans for this week.`,
      )
    }
    scansUsed += 1
    return {
      status: 200,
      body: { rubric: SCANNED_RUBRIC, model: 'google/gemini-2.5-flash', quota: scanQuota() },
    }
  }
  return error(404, 'not_found', `No fake route for ${method} ${path}`)
}

function scanQuota() {
  return {
    available: scanningAvailable,
    used: scansUsed,
    limit: SCAN_LIMIT,
    next_free_at: scansUsed ? NEXT_FREE_AT : null,
  }
}

/** What the fake scanner "reads": an original example rubric, highest-first levels already flipped. */
export const SCANNED_RUBRIC: ScannedRubric = {
  title: 'Example lab report rubric',
  levels: ['Beginning', 'Developing', 'Proficient'],
  criteria: [
    {
      name: 'Hypothesis',
      descriptors: ['No hypothesis', 'A vague hypothesis', 'A clear, testable hypothesis'],
      suggested_question: 'How clear and testable is the hypothesis?',
      suggested_tips: [
        'Write one sentence predicting what will happen.',
        'Make your prediction specific enough to test.',
        'Keep it up: link your conclusion back to it.',
      ],
    },
    {
      name: 'Data',
      descriptors: ['', 'Some data, loosely organized', 'Complete data in labelled tables'],
      suggested_question: 'How complete and well organized is the data?',
      suggested_tips: ['Record every measurement.', 'Put your data in a table.', 'Keep it up.'],
    },
  ],
  checklist: [{ name: 'Includes a title', suggested_question: 'Does the report have a title?' }],
  word_count: { min: 400, max: null },
  notes: 'The bottom-left cell was blank on the photo.',
}

export async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (offline) throw new TypeError('Failed to fetch')
  if (held) await held
  const method = (init.method ?? 'GET').toUpperCase()
  const path = new URL(String(input), 'http://localhost').pathname
  const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
  requests.push({ method, path, body })
  const reply = handle(method, path, body)
  return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
