import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { runCheck } from '../lib/api'
import { loadData } from '../lib/localStore'
import { SAMPLE_ESSAY } from '../lib/sampleEssay'
import { fakeBackend, requests, TEST_PASSWORD } from '../test/fakeBackend'
import { renderRoute } from '../test/renderRoute'

describe('Settings', () => {
  it('shows the account and saves a display name on the server', async () => {
    const { user } = await renderRoute('/settings')
    expect(await screen.findByText('Signed in as test1@rubriqly.com.')).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: 'Display name' })
    expect(input).toHaveValue('Test Student One')
    fireEvent.change(input, { target: { value: 'Ada Lovelace' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    const sidebar = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(within(sidebar).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(sidebar).getByText('AL')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: '/api/auth/me',
      body: { display_name: 'Ada Lovelace' },
    })
  })

  it('switches between light, dark and system themes', async () => {
    const { user } = await renderRoute('/settings')
    await user.click(await screen.findByRole('radio', { name: /dark/i }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('rubriqly:theme')).toBe('dark')

    await user.click(screen.getByRole('radio', { name: /system/i }))
    expect(screen.getByRole('radio', { name: /system/i })).toBeChecked()
    // jsdom has no prefers-color-scheme, so "system" resolves to light here.
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('rubriqly:theme')).toBeNull()
  })

  it('asks before deleting all data, then clears this account’s drafts', async () => {
    await runCheck({ rubricId: 'argumentative-essay', prompt: '', text: SAMPLE_ESSAY })
    const { user } = await renderRoute('/settings')
    const sidebar = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(
      await within(sidebar).findByRole('link', { name: /Why the 1918 Flu/ }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete all data' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(loadData().checks).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete all data' }))
    await user.click(screen.getByRole('button', { name: 'Delete everything' }))
    expect(
      await screen.findByText('Your drafts, results and rubrics were deleted from this device.'),
    ).toBeVisible()
    expect(loadData().checks).toHaveLength(0)
    expect(await within(sidebar).findByText('Drafts you check will show up here.')).toBeVisible()
  })

  it('exports data without cancelling the download', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    try {
      const { user } = await renderRoute('/settings')
      await user.click(await screen.findByRole('button', { name: /Export my data/ }))
      expect(revoke).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(revoke).toHaveBeenCalledTimes(1)
    } finally {
      revoke.mockRestore()
      vi.useRealTimers()
    }
  })

  it('changes the password', async () => {
    const { user } = await renderRoute('/settings')
    fireEvent.change(await screen.findByLabelText('Current password'), {
      target: { value: 'not my password' },
    })
    fireEvent.change(screen.getByLabelText(/^New password/), {
      target: { value: 'a brand new passphrase' },
    })
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your current password is incorrect.',
    )

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: TEST_PASSWORD },
    })
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('Password changed.')).toBeInTheDocument()
  })

  it('signs out and goes to the sign-in page', async () => {
    const { user, router } = await renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/signin'))
    expect(fakeBackend.isSignedIn()).toBe(false)
  })

  it('deletes the account after the password is confirmed', async () => {
    await runCheck({ rubricId: 'argumentative-essay', prompt: '', text: SAMPLE_ESSAY })
    const { user, router } = await renderRoute('/settings')
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }))
    const confirm = screen.getByRole('form', { name: /can’t be undone/ })
    const password = within(confirm).getByLabelText('Password')

    fireEvent.change(password, { target: { value: 'wrong password!' } })
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your password is incorrect.')
    expect(loadData().checks).toHaveLength(1)

    fireEvent.change(password, { target: { value: TEST_PASSWORD } })
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(fakeBackend.isSignedIn()).toBe(false)
    expect(localStorage.getItem('rubriqly:v1:usr_test1')).toBeNull()
  })
})
