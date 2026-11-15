import { describe, expect, it } from 'vitest'
import {
  assignIds,
  blankRubricValues,
  builderSchema,
  rubricToValues,
  valuesToRubric,
} from './builderForm'
import { rubricToYaml } from './rubricYaml'
import { STARTER_RUBRICS } from './starterRubrics'

const pack = STARTER_RUBRICS[0]

describe('rubric <-> builder values', () => {
  it('round-trips criteria and checklist items', () => {
    const values = rubricToValues({ ...pack, source: 'mine' })
    const back = valuesToRubric(values, pack.id)
    expect(back.criteria).toEqual(pack.criteria)
    expect(back.checklist).toEqual(pack.checklist)
  })

  it('turns a built-in pack into an unsaved copy', () => {
    const values = rubricToValues(pack)
    expect(values.id).toBe('')
    expect(values.title).toBe('Argumentative essay (my copy)')
  })

  it('makes ids unique', () => {
    const items = blankRubricValues().items
    const named = assignIds([
      { ...items[0], name: 'Evidence' },
      { ...items[0], name: 'Evidence' },
    ])
    expect(named.map((i) => i.id)).toEqual(['evidence', 'evidence_2'])
  })
})

describe('builderSchema', () => {
  it('accepts a complete rubric', () => {
    expect(builderSchema.safeParse(rubricToValues(pack)).success).toBe(true)
  })

  it('requires every level descriptor and tip for score criteria', () => {
    const values = blankRubricValues()
    values.items[0] = { ...values.items[0], name: 'Thesis', question: 'Is there a thesis?' }
    const result = builderSchema.safeParse(values)
    expect(result.success).toBe(false)
    const paths = result.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('items.0.descriptors.0')
    expect(paths).toContain('items.0.tips.3')
  })
})

describe('rubricToYaml', () => {
  it('writes the rubric pack format with quoted strings', () => {
    const yaml = rubricToYaml(pack)
    expect(yaml).toContain('id: "argumentative-essay"')
    expect(yaml).toContain('levels: ["Beginning", "Developing", "Proficient", "Exemplary"]')
    expect(yaml).toContain(
      '    question: "How well does the essay explain how its evidence supports the thesis?"',
    )
    expect(yaml).toContain('  word_count: {min: 500, max: 900}')
  })
})

describe('limits the server can check', () => {
  const valid = () => rubricToValues({ ...pack, source: 'mine' })

  it('accepts a built-in pack', () => {
    expect(builderSchema.safeParse(valid()).success).toBe(true)
  })

  it('allows at most 12 score criteria', () => {
    const values = valid()
    const score = values.items.find((i) => i.kind === 'score')!
    values.items = [...values.items, ...Array.from({ length: 12 }, () => ({ ...score, id: '' }))]
    const result = builderSchema.safeParse(values)
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'A rubric can have at most 12 score criteria.',
    )
  })

  it('allows at most 15 yes/no questions', () => {
    const values = valid()
    const yesno = { ...values.items[0], kind: 'yesno' as const, id: '' }
    values.items = [...values.items, ...Array.from({ length: 16 }, () => yesno)]
    const result = builderSchema.safeParse(values)
    expect(result.error?.issues.map((i) => i.message)).toContain(
      'A rubric can have at most 15 yes/no questions.',
    )
  })

  it('limits names to 120 characters and questions and descriptions to 600', () => {
    const values = valid()
    values.title = 'x'.repeat(121)
    values.items[0] = {
      ...values.items[0],
      question: 'q'.repeat(601),
      descriptors: values.items[0].descriptors.map((d, i) => (i === 0 ? 'd'.repeat(601) : d)),
    }
    const issues = builderSchema.safeParse(values).error?.issues ?? []
    const at = (path: string) => issues.find((i) => i.path.join('.') === path)?.message
    expect(at('title')).toBe('Keep this to 120 characters or fewer.')
    expect(at('items.0.question')).toBe('Keep this to 600 characters or fewer.')
    expect(at('items.0.descriptors.0')).toBe('Keep this to 600 characters or fewer.')
  })
})
