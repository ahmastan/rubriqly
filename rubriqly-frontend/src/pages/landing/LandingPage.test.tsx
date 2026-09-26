import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../../test/renderRoute'
import { faq } from './content'

describe('Landing page', () => {
  it('is served at / outside the app shell', async () => {
    await renderRoute('/')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Know where your draft stands before you hit submit.',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('sends sign-in, sign-up and every call to action to the right place', async () => {
    const { user, router } = await renderRoute('/')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/signin')
    expect(screen.getAllByRole('link', { name: 'Sign up' })[0]).toHaveAttribute('href', '/signup')
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/ahmastan/rubriqly',
    )
    const ctas = screen.getAllByRole('link', { name: /check a draft/i })
    expect(ctas.length).toBeGreaterThanOrEqual(2)
    ctas.forEach((link) => expect(link).toHaveAttribute('href', '/check/new'))

    await user.click(ctas[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/check/new'))
  })

  it('links the nav to each section on the page', async () => {
    await renderRoute('/')
    const sections = (await screen.findAllByRole('navigation', { name: 'Page sections' }))[0]
    for (const [name, id] of [
      ['How it works', 'how-it-works'],
      ['Rubrics', 'rubrics'],
      ['For teachers', 'teachers'],
      ['FAQ', 'faq'],
    ]) {
      expect(within(sections).getByRole('link', { name })).toHaveAttribute('href', `#${id}`)
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '#demo')
  })

  it('glides nav and logo clicks on the page instead of navigating', async () => {
    const { user, router } = await renderRoute('/')
    const sections = (await screen.findAllByRole('navigation', { name: 'Page sections' }))[0]
    await user.click(within(sections).getByRole('link', { name: 'FAQ' }))
    expect(window.location.hash).toBe('#faq')
    await user.click(screen.getAllByRole('link', { name: 'Rubriqly home' })[0])
    expect(router.state.location.pathname).toBe('/')
    expect(window.location.hash).toBe('')
  })

  it('sends the logo home from the legal pages', async () => {
    const { user, router } = await renderRoute('/privacy')
    await user.click(screen.getAllByRole('link', { name: 'Rubriqly home' })[0])
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shows the real built-in rubrics plus build your own, in both library versions', async () => {
    await renderRoute('/')
    await screen.findByRole('heading', { level: 1 })
    for (const version of ['pinned', 'swipe']) {
      const library = document.querySelector(`[data-library="${version}"]`) as HTMLElement
      const cards = within(library)
        .getAllByRole('link')
        .map((a) => [a.getAttribute('href'), a.textContent])
      expect(cards).toEqual([
        ['/check/new?rubric=argumentative-essay', expect.stringContaining('Argumentative essay')],
        ['/check/new?rubric=lab-report', expect.stringContaining('Lab report')],
        ['/check/new?rubric=research-paper', expect.stringContaining('Research paper')],
        ['/rubrics/new', expect.stringContaining('Build your own')],
      ])
      // Each card previews what the rubric checks.
      expect(library).toHaveTextContent('Analysis explains how evidence supports the claim')
      expect(library).toHaveTextContent('500–900 words')
    }
  })

  it('opens FAQ answers', async () => {
    const { user } = await renderRoute('/')
    const question = await screen.findByText('Can it write my essay?')
    const details = question.closest('details')!
    expect(details).not.toHaveAttribute('open')
    await user.click(question)
    expect(details).toHaveAttribute('open')
  })

  it('keeps to the honesty rules', async () => {
    await renderRoute('/')
    await screen.findByRole('heading', { level: 1 })
    const text = document.body.textContent!.toLowerCase()
    for (const banned of [
      'proprietary',
      'all rights reserved',
      'closed source',
      'grader',
      'guaranteed',
      'ace your',
      'cloudflare',
    ]) {
      expect(text).not.toContain(banned)
    }
    // Every mention of "grade" is a denial or the FAQ question that answers "No".
    expect(text.match(/\bgrades?\b/g)?.length).toBe(
      text.match(/not a grade|not grades|decides the grade|is this a grade/g)?.length,
    )
    expect(text).toContain('vercel ai gateway')
    // The model that reads rubric photos is separate and never sees drafts.
    expect(text).toContain('only receives your rubric photos')
    expect(text).toContain('made-up draft')
  })

  it('has real Privacy, Terms and Contact pages', async () => {
    for (const [path, title] of [
      ['/privacy', 'Privacy policy'],
      ['/terms', 'Terms of use'],
      ['/contact', 'Contact'],
    ]) {
      const { unmount } = await renderRoute(path)
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
      expect(screen.queryByText(/placeholder/)).not.toBeInTheDocument()
      unmount()
    }
  })
})

describe('Landing page motion', () => {
  it('animates the hero in, but never hides the headline (it counts as the main paint)', async () => {
    await renderRoute('/')
    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading.style.opacity).not.toBe('0')
    expect(heading.style.transform).toContain('translateY(18px)')
    const subheadline = screen.getByText(/checks your draft against the rubric/)
    expect(subheadline.style.opacity).toBe('0')
  })
})

describe('Scroll demo', () => {
  it('renders the pinned desktop demo and the stacked mobile demo, both with all six steps', async () => {
    await renderRoute('/')
    await screen.findByRole('heading', { name: 'From pasted draft to a clear next step.' })
    const pinned = document.querySelector('[data-demo="pinned"]')!
    const stacked = document.querySelector('[data-demo="stacked"]')!
    expect(document.querySelector('[data-demo="static"]')).toBeNull()
    for (const version of [pinned, stacked]) {
      for (const title of ['Paste your draft', 'Pick the rubric', 'Watch it improve']) {
        expect(version).toHaveTextContent(title)
      }
    }
    // Screen readers get every step as a list, with the first marked current before scrolling.
    const steps = pinned.querySelectorAll('ol.sr-only li')
    expect(steps).toHaveLength(6)
    expect(steps[0]).toHaveAttribute('aria-current', 'step')
    expect(steps[0]).toHaveTextContent('Paste your draft. Paste it or upload a file.')
    // The pictures are decorative; the step text carries the meaning.
    expect(pinned.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('Statement and How it works', () => {
  it('gives screen readers the statement as one sentence, not word fragments', async () => {
    await renderRoute('/')
    const section = await screen.findByRole('region', { name: "Rubriqly can't write for you" })
    const sentence =
      'Rubriqly scores your draft against the rubric. It never writes, rewrites, or finishes a sentence for you.'
    expect(within(section).getByText(sentence)).toHaveClass('sr-only')
    // The word-by-word version is visual only.
    const words = section.querySelector('p > span[aria-hidden="true"]')!
    expect(words.querySelectorAll('span')).toHaveLength(sentence.split(' ').length)
  })

  it('shows three steps, each with a decorative illustration', async () => {
    await renderRoute('/')
    const section = (
      await screen.findByRole('heading', { name: 'Three steps, then you revise.' })
    ).closest('section')!
    const steps = within(section).getAllByRole('listitem')
    expect(steps.map((li) => within(li).getByRole('heading').textContent)).toEqual([
      'Pick a rubric',
      'Add your draft',
      'Revise with feedback',
    ])
    steps.forEach((li) => expect(li.querySelector('[aria-hidden="true"]')).not.toBeNull())
  })
})

describe('Smooth scrolling', () => {
  it('is on for the landing page and off again inside the app', async () => {
    const { user } = await renderRoute('/')
    await screen.findByRole('heading', { level: 1 })
    expect(document.documentElement).toHaveClass('lenis')

    await user.click(screen.getAllByRole('link', { name: 'Sign up' })[0])
    await screen.findByRole('heading', { name: 'Check a draft' })
    expect(document.documentElement).not.toHaveClass('lenis')
  })
})

describe('Closing sections', () => {
  it('reads the final headline as one sentence and links into the app', async () => {
    await renderRoute('/')
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: 'Your next draft, checked before it’s due.',
    })
    expect(heading.querySelector('.sr-only')).toHaveTextContent(
      'Your next draft, checked before it’s due.',
    )
    const section = heading.closest('section')!
    expect(within(section).getByRole('link', { name: /check a draft/i })).toHaveAttribute(
      'href',
      '/check/new',
    )
  })

  it('gives every FAQ answer the slide-open styling', async () => {
    await renderRoute('/')
    await screen.findByRole('heading', { name: 'Questions' })
    const items = document.querySelectorAll('details.faq-item')
    expect(items).toHaveLength(faq.items.length)
    items.forEach((item) => expect(item.querySelector('.faq-answer')).not.toBeNull())
  })
})

describe('Polish', () => {
  it('keeps the nav see-through over the hero, and solid while the menu is open', async () => {
    const { user } = await renderRoute('/')
    const header = screen.getByRole('banner')
    expect(header).not.toHaveAttribute('data-scrolled')
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(header).toHaveAttribute('data-scrolled')
  })

  it('paints the landing pages dark and hands the background back to the app', async () => {
    const { user } = await renderRoute('/')
    expect(document.documentElement).toHaveAttribute('data-landing')
    await user.click(screen.getAllByRole('link', { name: 'Sign up' })[0])
    await screen.findByRole('heading', { name: 'Check a draft' })
    expect(document.documentElement).not.toHaveAttribute('data-landing')
  })
})
