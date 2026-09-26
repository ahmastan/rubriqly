import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listRubrics } from '../lib/api'
import { fakeBackend, requests } from '../test/fakeBackend'
import { renderRoute } from '../test/renderRoute'

function photo(name: string, ...bytes: number[]) {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

async function scanTwoPages() {
  const rendered = await renderRoute('/rubrics/scan')
  await rendered.user.upload(screen.getByLabelText('Choose rubric photos'), [
    photo('page-1.png', 1, 1, 1),
    photo('page-2.png', 2, 2, 2),
  ])
  return rendered
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Scanning a rubric', () => {
  it('is offered on the Rubrics page', async () => {
    const { user, router } = await renderRoute('/rubrics')
    await user.click((await screen.findAllByRole('link', { name: 'Scan a rubric' }))[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/rubrics/scan'))
    expect(await screen.findByRole('heading', { name: 'Scan a rubric' })).toBeInTheDocument()
  })

  it('shows the scans left this week and what happens to the photos', async () => {
    fakeBackend.setScansUsed(2)
    await renderRoute('/rubrics/scan')
    expect(await screen.findByText('3 of 5 scans left this week.')).toBeInTheDocument()
    expect(screen.getByText(/Google’s Gemini model reads them/)).toHaveTextContent(
      'aren’t kept by Rubriqly',
    )
    expect(screen.getByRole('button', { name: 'Scan rubric' })).toBeDisabled()
  })

  it('sends the pages in order, then opens the builder with the scanned rubric', async () => {
    const { user, router } = await scanTwoPages()
    const pages = screen.getByRole('list', { name: 'Photos, in page order' })
    expect(within(pages).getAllByRole('listitem')).toHaveLength(2)

    // Put page 2 first.
    await user.click(screen.getByRole('button', { name: 'Move page 2 up' }))
    expect(within(pages).getAllByRole('listitem')[0]).toHaveTextContent('page-2.png')

    await user.click(screen.getByRole('button', { name: 'Scan 2 pages' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/rubrics/new'))

    const sent = requests.find((r) => r.path === '/api/rubric-scans')?.body as {
      images: { data: string }[]
    }
    expect(sent.images.map((i) => i.data)).toEqual([btoa('\x02\x02\x02'), btoa('\x01\x01\x01')])

    expect(await screen.findByText(/Scanned from your photos/)).toHaveTextContent('Not saved yet')
    expect(screen.getByText(/The bottom-left cell was blank/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Rubric name' })).toHaveValue(
      'Example lab report rubric',
    )
    expect(screen.getByRole('textbox', { name: 'Beginning: what it looks like' })).toHaveValue(
      'No hypothesis',
    )
  })

  it('marks the AI’s questions and tips as suggested until they are edited', async () => {
    const { user } = await scanTwoPages()
    await user.click(screen.getByRole('button', { name: 'Scan 2 pages' }))

    const question = await screen.findByRole('textbox', { name: 'Question for Jev' })
    expect(question).toHaveValue('How clear and testable is the hypothesis?')
    expect(question).toHaveAccessibleDescription('Suggested by AI. Check it before saving.')
    // One pill for the question, three for the tips.
    expect(screen.getAllByText('Suggested')).toHaveLength(4)

    fireEvent.change(question, { target: { value: 'How testable is the hypothesis?' } })
    expect(question).not.toHaveAccessibleDescription()
    expect(screen.getAllByText('Suggested')).toHaveLength(3)
    // The level descriptions are copied from the rubric, so they're never marked.
    expect(
      screen.getByRole('textbox', { name: 'Beginning: what it looks like' }),
    ).not.toHaveAccessibleDescription()
  })

  it('asks for blank cells to be filled in, then saves like any rubric', async () => {
    const { user, router } = await scanTwoPages()
    await user.click(screen.getByRole('button', { name: 'Scan 2 pages' }))
    await screen.findByText(/Scanned from your photos/)

    await user.click(screen.getByRole('button', { name: 'Save rubric' }))
    // The "Data" criterion had a blank cell, so the builder opens it with the problem.
    expect(await screen.findByText('Describe this level.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Beginning: what it looks like' }), {
      target: { value: 'No data recorded' },
    })
    await user.click(screen.getByRole('button', { name: 'Save rubric' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(
        /^\/rubrics\/example_lab_report_rubric_.+\/edit$/,
      ),
    )
    expect(await screen.findByText('Saved on this computer')).toBeInTheDocument()
    expect(screen.queryByText(/Scanned from your photos/)).not.toBeInTheDocument()
    const [saved] = (await listRubrics()).filter((r) => r.source === 'mine')
    expect(saved.criteria[1].descriptors[0]).toBe('No data recorded')
    expect(saved.criteria[0].tips[0]).toBe('Write one sentence predicting what will happen.')
    expect(saved.rules).toEqual({ word_count: { min: 400 } })
  })

  it('checks before leaving an unsaved scan', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, router } = await scanTwoPages()
    await user.click(screen.getByRole('button', { name: 'Scan 2 pages' }))
    await screen.findByText(/Scanned from your photos/)

    await user.click(screen.getAllByRole('link', { name: 'Rubrics' })[0])
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('uses one of your weekly scans'))
    expect(router.state.location.pathname).toBe('/rubrics/new')

    confirm.mockReturnValue(true)
    await user.click(screen.getAllByRole('link', { name: 'Rubrics' })[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/rubrics'))
  })

  it('shows why a scan failed and keeps the photos to try again', async () => {
    fakeBackend.failNextScan(
      422,
      'scan_unreadable',
      'We couldn’t read this rubric clearly. Try a sharper, straight-on photo.',
    )
    const { user, router } = await scanTwoPages()
    await user.click(screen.getByRole('button', { name: 'Scan 2 pages' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try a sharper, straight-on photo')
    expect(router.state.location.pathname).toBe('/rubrics/scan')
    expect(screen.getAllByRole('img', { name: /^Page/ })).toHaveLength(2)
  })

  it('stops at the weekly limit and says when the next scan is available', async () => {
    fakeBackend.setScansUsed(5)
    const { user } = await renderRoute('/rubrics/scan')
    expect(await screen.findByText(/You’ve used this week’s 5 scans/)).toHaveTextContent(
      'Your next scan is available',
    )
    await user.upload(screen.getByLabelText('Choose rubric photos'), photo('page.png', 1))
    expect(screen.getByRole('button', { name: 'Scan rubric' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Build one by hand instead' })).toHaveAttribute(
      'href',
      '/rubrics/new',
    )
  })

  it('says so when scanning isn’t switched on', async () => {
    fakeBackend.disableScanning()
    const { user } = await renderRoute('/rubrics/scan')
    expect(await screen.findByText(/Rubric scanning isn’t available right now/)).toBeInTheDocument()
    await user.upload(screen.getByLabelText('Choose rubric photos'), photo('page.png', 1))
    expect(screen.getByRole('button', { name: 'Scan rubric' })).toBeDisabled()
  })

  it('takes up to three photos', async () => {
    const { user } = await renderRoute('/rubrics/scan')
    await user.upload(
      screen.getByLabelText('Choose rubric photos'),
      [1, 2, 3, 4].map((n) => photo(`page-${n}.png`, n)),
    )
    expect(screen.getAllByRole('img', { name: /^Page/ })).toHaveLength(3)
    expect(screen.getByText(/up to 3 photos, so some weren’t added/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove page 3' }))
    expect(screen.getAllByRole('img', { name: /^Page/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Add another page' })).toBeInTheDocument()
  })

  it('never sends files that aren’t photos', async () => {
    await renderRoute('/rubrics/scan')
    const pdf = new File(['%PDF-1.7'], 'rubric.pdf', { type: 'application/pdf' })
    // The picker only offers images, but a file can still arrive another way (e.g. drag and drop).
    fireEvent.change(screen.getByLabelText('Choose rubric photos'), { target: { files: [pdf] } })
    expect(screen.getByText(/Only photos can be scanned/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Page/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan rubric' })).toBeDisabled()
    expect(requests.some((r) => r.path === '/api/rubric-scans')).toBe(false)
  })
})
