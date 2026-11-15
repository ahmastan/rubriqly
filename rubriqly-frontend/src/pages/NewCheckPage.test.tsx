import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCheck } from '../lib/api'
import { loadData, updateData } from '../lib/localStore'
import { SAMPLE_ESSAY } from '../lib/sampleEssay'
import { STARTER_RUBRICS } from '../lib/starterRubrics'
import { fakeBackend, requests } from '../test/fakeBackend'
import { makeDocx } from '../test/files'
import { renderRoute } from '../test/renderRoute'

describe('New check', () => {
  it('picks a rubric and shows what it checks', async () => {
    const { user } = await renderRoute('/check/new')
    const rubric = await screen.findByRole('combobox', { name: 'Rubric' })
    expect(await screen.findByRole('option', { name: 'Argumentative essay' })).toBeInTheDocument()
    expect(rubric).toHaveValue('argumentative-essay')
    expect(screen.getByText('What gets checked')).toBeInTheDocument()
    expect(screen.getByText('Thesis')).toBeInTheDocument()

    await user.selectOptions(rubric, 'lab-report')
    expect(screen.getByText('Methods')).toBeInTheDocument()
  })

  it('preselects the rubric from the link', async () => {
    await renderRoute('/check/new?rubric=research-paper')
    await screen.findByRole('option', { name: 'Research paper' })
    expect(screen.getByRole('combobox', { name: 'Rubric' })).toHaveValue('research-paper')
  })

  it('asks for a draft before checking', async () => {
    const { user } = await renderRoute('/check/new')
    await user.click(await screen.findByRole('button', { name: 'Check draft' }))
    expect(await screen.findByText('Paste or upload your draft first.')).toBeInTheDocument()
  })

  it('counts words live', async () => {
    await renderRoute('/check/new')
    const draft = await screen.findByRole('textbox', { name: 'Your draft' })
    fireEvent.change(draft, { target: { value: 'one two three' } })
    expect(await screen.findByText('3 words')).toBeInTheDocument()
  })

  it('reveals the optional assignment prompt', async () => {
    const { user } = await renderRoute('/check/new')
    await user.click(await screen.findByRole('button', { name: 'Prompt' }))
    expect(screen.getByRole('textbox', { name: /assignment prompt/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove assignment prompt' }))
    expect(screen.queryByRole('textbox', { name: /assignment prompt/i })).not.toBeInTheDocument()
  })

  it('reads an uploaded .txt file into the draft', async () => {
    const { user } = await renderRoute('/check/new')
    const file = new File(['First paragraph.\n\nSecond paragraph.'], 'draft.txt', {
      type: 'text/plain',
    })
    await user.upload(await screen.findByLabelText('Upload a draft file'), file)
    expect(await screen.findByRole('textbox', { name: 'Your draft' })).toHaveValue(
      'First paragraph.\n\nSecond paragraph.',
    )
  })

  it('reads an uploaded .docx into the draft box', async () => {
    await renderRoute('/check/new')
    const file = await makeDocx(['My Essay Title', 'The first paragraph.', 'The second one.'])
    fireEvent.change(await screen.findByLabelText('Upload a draft file'), {
      target: { files: [file] },
    })

    expect(await screen.findByText('Read 3 paragraphs from draft.docx.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your draft' })).toHaveValue(
      'My Essay Title\n\nThe first paragraph.\n\nThe second one.',
    )
  })

  it('explains files it can’t read', async () => {
    await renderRoute('/check/new')
    // (The file picker would hide .doc files; a drag-and-drop or "all files" choice can still pick one.)
    fireEvent.change(await screen.findByLabelText('Upload a draft file'), {
      target: { files: [new File(['x'], 'draft.doc')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Save it as .docx/)
  })

  it('runs a check and opens the results', async () => {
    const { user, router } = await renderRoute('/check/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))

    expect(
      await screen.findByText('An estimate to guide revision, not a grade.'),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/checks\/chk_/)
  })

  it('submits with Ctrl + Enter', async () => {
    const { user, router } = await renderRoute('/check/new')
    const draft = await screen.findByRole('textbox', { name: 'Your draft' })
    fireEvent.change(draft, { target: { value: SAMPLE_ESSAY } })
    draft.focus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await screen.findByText('An estimate to guide revision, not a grade.')
    expect(router.state.location.pathname).toMatch(/^\/checks\//)
  })
})

describe('Scoring on the server', () => {
  async function submitSample() {
    const rendered = await renderRoute('/check/new')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    await rendered.user.click(screen.getByRole('button', { name: 'Check draft' }))
    return rendered
  }

  it('sends the rubric without its tips', async () => {
    await submitSample()
    await screen.findByText('An estimate to guide revision, not a grade.')
    const sent = requests.find((r) => r.path === '/api/checks')!.body as {
      rubric: { criteria: object[] }
      text: string
    }
    expect(sent.text).toBe(SAMPLE_ESSAY)
    expect(sent.rubric.criteria[0]).not.toHaveProperty('tips')
    expect(JSON.stringify(sent)).not.toContain(STARTER_RUBRICS[0].criteria[0].tips[0])
  })

  it('shows the server’s message when scoring fails, and saves nothing', async () => {
    fakeBackend.failNextCheck(
      503,
      'scoring_unavailable',
      'Scoring is unavailable right now. Please try again in a minute.',
    )
    const { router } = await submitSample()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Scoring is unavailable right now. Please try again in a minute.',
    )
    expect(router.state.location.pathname).toBe('/check/new')
    expect(loadData().checks).toHaveLength(0)
    expect(loadData().drafts).toHaveLength(0)
  })

  it('says so when the server can’t be reached', async () => {
    await renderRoute('/check/new')
    fakeBackend.goOffline()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t reach Rubriqly right now')
  })

  it('sends students to sign in when their session has ended', async () => {
    await renderRoute('/check/new')
    fakeBackend.signOut()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check draft' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('Next draft', () => {
  it('brings the assignment’s prompt along and sends it again', async () => {
    await runCheck({ rubricId: STARTER_RUBRICS[0].id, prompt: 'Argue a side.', text: SAMPLE_ESSAY })
    const assignment = loadData().assignments[0]
    const { user } = await renderRoute(
      `/check/new?assignment=${assignment.id}&rubric=${STARTER_RUBRICS[0].id}`,
    )
    expect(await screen.findByRole('textbox', { name: /assignment prompt/i })).toHaveValue(
      'Argue a side.',
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    await screen.findByText('An estimate to guide revision, not a grade.')
    const sent = requests.filter((r) => r.path === '/api/checks').at(-1)!.body as { prompt: string }
    expect(sent.prompt).toBe('Argue a side.')
    expect(loadData().assignments[0].prompt).toBe('Argue a side.')
  })

  it('fills in the prompt and rubric when an assignment is picked', async () => {
    await runCheck({ rubricId: STARTER_RUBRICS[1].id, prompt: 'Argue a side.', text: SAMPLE_ESSAY })
    const { user } = await renderRoute('/check/new')
    await user.selectOptions(
      await screen.findByRole('combobox', { name: /^Draft 1 of/ }),
      loadData().assignments[0].id,
    )
    expect(screen.getByRole('textbox', { name: /assignment prompt/i })).toHaveValue('Argue a side.')
    expect(screen.getByRole('combobox', { name: /rubric/i })).toHaveValue(STARTER_RUBRICS[1].id)
  })
})

describe('Rubrics too big to check', () => {
  it('says what to fix and doesn’t send the draft', async () => {
    const pack = STARTER_RUBRICS[0]
    updateData((data) => {
      data.rubrics.push({
        ...pack,
        id: 'too_big',
        source: 'mine',
        criteria: Array.from({ length: 13 }, (_, i) => ({ ...pack.criteria[0], id: `c${i}` })),
      })
    })
    const { user } = await renderRoute('/check/new?rubric=too_big')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This rubric has 13 score criteria; the most that can be checked is 12.',
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Your draft' }), {
      target: { value: SAMPLE_ESSAY },
    })
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    expect(requests.some((r) => r.path === '/api/checks')).toBe(false)
  })
})

describe('Storage full', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('explains it before scoring, and keeps the draft in the box', async () => {
    await runCheck({ rubricId: STARTER_RUBRICS[0].id, prompt: '', text: SAMPLE_ESSAY })
    const { user, router } = await renderRoute('/check/new')
    const draft = await screen.findByRole('textbox', { name: 'Your draft' })
    fireEvent.change(draft, { target: { value: SAMPLE_ESSAY } })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const checksBefore = requests.filter((r) => r.path === '/api/checks').length
    await user.click(screen.getByRole('button', { name: 'Check draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your browser’s storage for Rubriqly is full',
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))
    expect(draft).toHaveValue(SAMPLE_ESSAY)
    // The paid scoring call was never made.
    expect(requests.filter((r) => r.path === '/api/checks')).toHaveLength(checksBefore)
  })
})

describe('Privacy notice', () => {
  it('says truthfully where the text goes', async () => {
    await renderRoute('/check/new')
    const notice = await screen.findByText(/Drafts are saved on this computer/)
    expect(notice).toHaveTextContent('Vercel AI Gateway')
    expect(notice).toHaveTextContent('isn’t used for training')
    expect(notice).toHaveTextContent('never writes anything for you')
  })
})
