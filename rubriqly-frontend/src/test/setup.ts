import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { setStorageUser } from '../lib/localStore'
import { fakeFetch, resetFakeBackend } from './fakeBackend'

// jsdom has no IntersectionObserver (used for "animate when scrolled into view"). This stand-in
// never reports anything as visible, which is fine: tests check content, not animation.
if (!('IntersectionObserver' in globalThis)) {
  class NoopIntersectionObserver {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  globalThis.IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver
}

// jsdom has no ResizeObserver (Lenis uses it to notice the page changing size).
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom has no matchMedia either (used for dark mode and reduced motion). Default: nothing matches.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom can't make object URLs (used for photo thumbnails). A placeholder address is enough.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:rubriqly-test'
  URL.revokeObjectURL = () => {}
}

// Every test talks to the in-memory fake backend and starts signed in as test1@rubriqly.com, with
// that account's drafts selected (so tests can call the data layer before rendering).
beforeEach(() => {
  resetFakeBackend()
  globalThis.fetch = fakeFetch as typeof fetch
  setStorageUser('usr_test1')
})

afterEach(() => {
  cleanup()
  setStorageUser(null)
  localStorage.clear()
  delete document.documentElement.dataset.theme
})
