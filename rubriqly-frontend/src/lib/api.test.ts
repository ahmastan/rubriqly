import { describe, expect, it } from 'vitest'
import { exportLocalData, runCheck, saveRubric } from './api'
import { loadData } from './localStore'
import { SAMPLE_ESSAY } from './sampleEssay'
import { STARTER_RUBRICS } from './starterRubrics'
import type { Rubric } from './types'

const mine: Rubric = { ...STARTER_RUBRICS[0], id: 'my_rubric', source: 'mine', version: 1 }

describe('saving a rubric', () => {
  it('keeps the version when only tips change, so drafts stay comparable', async () => {
    await saveRubric(mine)
    const criteria = mine.criteria.map((c, i) =>
      i === 0 ? { ...c, tips: c.tips.map((t) => `${t} (reworded)`) } : c,
    )
    const saved = await saveRubric({ ...mine, criteria })
    expect(saved.version).toBe(1)
    expect(loadData().rubrics[0].criteria[0].tips[0]).toContain('(reworded)')
  })

  it('keeps the version when only names change', async () => {
    await saveRubric(mine)
    const criteria = mine.criteria.map((c, i) => (i === 0 ? { ...c, name: `${c.name}!` } : c))
    expect((await saveRubric({ ...mine, title: 'Renamed', criteria })).version).toBe(1)
  })

  it('starts a new version when anything that affects the result changes', async () => {
    await saveRubric(mine)
    const criteria = mine.criteria.map((c, i) =>
      i === 0 ? { ...c, question: `${c.question} Be strict.` } : c,
    )
    expect((await saveRubric({ ...mine, criteria })).version).toBe(2)
    expect(
      (await saveRubric({ ...mine, criteria, rules: { word_count: { min: 300 } } })).version,
    ).toBe(3)
  })
})

describe('checking a draft', () => {
  it('saves the prompt it was checked with', async () => {
    await runCheck({ rubricId: STARTER_RUBRICS[0].id, prompt: 'Argue a side.', text: SAMPLE_ESSAY })
    expect(loadData().assignments[0].prompt).toBe('Argue a side.')
  })
})

describe('export', () => {
  it('includes saved data the browser couldn’t read, as it was', () => {
    localStorage.setItem('rubriqly:v1:usr_test1', 'not json')
    loadData()
    expect(exportLocalData().damagedData).toEqual(['not json'])
  })
})
