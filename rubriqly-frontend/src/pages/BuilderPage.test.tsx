import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listRubrics } from '../lib/api'
import { updateData } from '../lib/localStore'
import { STARTER_RUBRICS } from '../lib/starterRubrics'
import { renderRoute } from '../test/renderRoute'

describe('Rubric builder', () => {
  it('shows the exact question sent to Jev, without tips', async () => {
    const { user } = await renderRoute('/rubrics/argumentative-essay/edit')
    await user.click(await screen.findByRole('button', { name: /^Analysis/ }))

    const panel = screen.getByRole('complementary', { name: 'What Jev receives' })
    const json = JSON.parse(within(panel).getByText(/"analysis"/).textContent!)
    expect(json.analysis.type).toBe('score')
    expect(json.analysis.criteria).toHaveLength(4)
    expect(panel).not.toHaveTextContent('Pick one quote')
  })

  it('updates the preview live as the question changes', async () => {
    await renderRoute('/rubrics/argumentative-essay/edit')
    const question = await screen.findByRole('textbox', { name: 'Question for Jev' })
    fireEvent.change(question, { target: { value: 'Is the thesis arguable?' } })
    const panel = screen.getByRole('complementary', { name: 'What Jev receives' })
    expect(panel).toHaveTextContent('Is the thesis arguable?')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('shows yes/no items as boolean questions without a levels table', async () => {
    const { user } = await renderRoute('/rubrics/argumentative-essay/edit')
    await user.click(await screen.findByRole('button', { name: /^Addresses a counterargument/ }))
    expect(screen.getByRole('complementary', { name: 'What Jev receives' })).toHaveTextContent(
      '"type": "boolean"',
    )
    expect(screen.queryByRole('textbox', { name: /what it looks like/ })).not.toBeInTheDocument()
  })

  it('validates missing level text before saving', async () => {
    const { user } = await renderRoute('/rubrics/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Criterion name' }), {
      target: { value: 'Thesis' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Question for Jev' }), {
      target: { value: 'Is there a clear thesis?' },
    })
    await user.click(screen.getByRole('button', { name: 'Save rubric' }))
    expect((await screen.findAllByText('Describe this level.')).length).toBe(4)
    expect(screen.getAllByText('Add a tip for this level.').length).toBe(4)
  })

  it('saves a copy of a built-in pack as your own rubric', async () => {
    const { user, router } = await renderRoute('/rubrics/lab-report/edit')
    await user.click(await screen.findByRole('button', { name: 'Save rubric' }))
    // Saving a pack creates a copy with its own id, then reopens the builder on it.
    await waitFor(
      () =>
        expect(router.state.location.pathname).toMatch(/^\/rubrics\/lab_report_my_copy_.+\/edit$/),
      { timeout: 3000 },
    )
    expect(await screen.findByText('Saved on this computer', {}, { timeout: 3000 })).toBeVisible()
    const mine = (await listRubrics()).filter((r) => r.source === 'mine')
    expect(mine.map((r) => r.title)).toEqual(['Lab report (my copy)'])
  })

  it('adds and removes criteria', async () => {
    const { user } = await renderRoute('/rubrics/new')
    const nav = await screen.findByRole('navigation', { name: 'Criteria' })
    await user.click(within(nav).getByRole('button', { name: '+ Add criterion' }))
    expect(within(nav).getAllByRole('button', { name: /^Untitled criterion/ })).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove criterion' }))
    expect(within(nav).getAllByRole('button', { name: /^Untitled criterion/ })).toHaveLength(1)
  })

  it('has no Import button until importing works', async () => {
    await renderRoute('/rubrics/new')
    await screen.findByRole('button', { name: 'Save rubric' })
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument()
  })

  it('stops at 12 score criteria, the most the server can check', async () => {
    const pack = STARTER_RUBRICS[0]
    updateData((data) => {
      data.rubrics.push({
        ...pack,
        id: 'too_big',
        source: 'mine',
        criteria: Array.from({ length: 13 }, (_, i) => ({ ...pack.criteria[0], id: `c${i}` })),
      })
    })
    await renderRoute('/rubrics/too_big/edit')
    // Marked as soon as it opens, and no more can be added.
    expect(
      await screen.findByText('A rubric can have at most 12 score criteria.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/13 of 12 score/)).toBeInTheDocument()
    // Score criteria are full, but yes/no questions can still be added.
    expect(screen.queryByRole('button', { name: '+ Add criterion' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add yes/no question' })).toBeEnabled()
  })

  it('shows every level even when two share a name', async () => {
    const pack = STARTER_RUBRICS[0]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateData((data) => {
      data.rubrics.push({
        ...pack,
        id: 'same_names',
        source: 'mine',
        levels: ['Level', 'Level', 'Top'],
        criteria: [{ ...pack.criteria[0], descriptors: ['a', 'b', 'c'], tips: ['x', 'y', 'z'] }],
        checklist: [],
      })
    })
    await renderRoute('/rubrics/same_names/edit')
    expect(await screen.findAllByRole('textbox', { name: /what it looks like/ })).toHaveLength(3)
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
