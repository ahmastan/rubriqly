import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { loadData } from '../lib/localStore'
import { fakeBackend, requests, resetFakeBackend, TEST_PASSWORD } from '../test/fakeBackend'
import { renderRoute } from '../test/renderRoute'

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('Signing in', () => {
  it('sends signed-out visitors to sign in, then back where they were going', async () => {
    resetFakeBackend({ signedIn: false })
    const { user, router } = await renderRoute('/rubrics')
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(router.state.location.search).toBe('?next=%2Frubrics')

    fill('Email', 'test1@rubriqly.com')
    fill('Password', 'wrong password!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')

    fill('Password', TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/rubrics'))
  })

  it('skips the form when already signed in', async () => {
    const { router } = await renderRoute('/signin?next=/settings')
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('never sends people to another website after signing in', async () => {
    resetFakeBackend({ signedIn: false })
    const { user, router } = await renderRoute('/signin?next=//evil.example')
    fill('Email', 'test1@rubriqly.com')
    fill('Password', TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))
  })

  it('says the server is waking up when signing in takes a while', async () => {
    resetFakeBackend({ signedIn: false })
    const { router } = await renderRoute('/signin')
    fill('Email', 'test1@rubriqly.com')
    fill('Password', TEST_PASSWORD)
    const release = fakeBackend.holdReplies()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
      act(() => vi.advanceTimersByTime(100))
      expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
      expect(screen.queryByText(/Waking up/)).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(3000))
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waking up Rubriqly’s server. This can take a minute or two.',
      )
    } finally {
      vi.useRealTimers()
    }
    release()
    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))
  })

  it('explains how to get a forgotten password reset', async () => {
    resetFakeBackend({ signedIn: false })
    await renderRoute('/signin')
    expect(screen.getByText(/Forgot your password/)).toHaveTextContent('and we’ll reset it')
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
  })
})

describe('Signing up', () => {
  it('needs the age and terms boxes, then creates the account', async () => {
    resetFakeBackend({ signedIn: false })
    const { user, router } = await renderRoute('/signup')
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')

    fill('Name', 'Test Student Two')
    fill('Email', 'test2@rubriqly.com')
    fill(/^Password/, 'another good passphrase')
    const age = screen.getByRole('checkbox', { name: 'I’m 13 or older.' })
    const terms = screen.getByRole('checkbox', { name: /I agree to the Terms/ })
    expect(age).toBeRequired()
    expect(terms).toBeRequired()
    await user.click(age)
    await user.click(terms)
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))
    expect(requests.find((r) => r.path === '/api/auth/signup')?.body).toMatchObject({
      display_name: 'Test Student Two',
      email: 'test2@rubriqly.com',
      confirms_age: true,
      accepts_terms: true,
    })
    expect(fakeBackend.isSignedIn()).toBe(true)
  })

  it('shows the server’s reason when sign-up is refused', async () => {
    resetFakeBackend({ signedIn: false })
    const { user } = await renderRoute('/signup')
    fill('Name', 'Someone')
    fill('Email', 'test1@rubriqly.com')
    fill(/^Password/, 'another good passphrase')
    await user.click(screen.getByRole('checkbox', { name: 'I’m 13 or older.' }))
    await user.click(screen.getByRole('checkbox', { name: /I agree to the Terms/ }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email already has an account. Sign in?',
    )
  })
})

describe('Accounts on a shared computer', () => {
  it('shows each account only its own drafts', async () => {
    const { runCheck } = await import('../lib/api')
    const { SAMPLE_ESSAY } = await import('../lib/sampleEssay')
    await runCheck({ rubricId: 'argumentative-essay', prompt: '', text: SAMPLE_ESSAY })
    expect(loadData().checks).toHaveLength(1)

    resetFakeBackend({ signedIn: false })
    fakeBackend.addAccount('test2@rubriqly.com', 'Test Student Two', 'usr_test2')
    const { user, router } = await renderRoute('/signin')
    fill('Email', 'test2@rubriqly.com')
    fill('Password', TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))

    expect(await screen.findAllByText('Drafts you check will show up here.')).not.toHaveLength(0)
    expect(loadData().checks).toHaveLength(0)
  })
})
