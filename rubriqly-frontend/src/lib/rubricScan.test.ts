import { describe, expect, it } from 'vitest'
import { SCANNED_RUBRIC } from '../test/fakeBackend'
import { valuesToRubric } from './builderForm'
import { isSuggested, PhotoError, preparePhoto, scannedToBuilderValues } from './rubricScan'

describe('scannedToBuilderValues', () => {
  it('turns criteria into score items and checklist items into yes/no items', () => {
    const { values } = scannedToBuilderValues(SCANNED_RUBRIC)
    expect(values.title).toBe('Example lab report rubric')
    expect(values.levels).toEqual(['Beginning', 'Developing', 'Proficient'])
    expect(values.items.map((i) => [i.id, i.kind])).toEqual([
      ['hypothesis', 'score'],
      ['data', 'score'],
      ['includes_a_title', 'yesno'],
    ])
    expect(values.items[0].question).toBe('How clear and testable is the hypothesis?')
    expect(values.items[1].descriptors[0]).toBe('')
    expect(values.items[2].descriptors).toEqual(['', '', ''])
    expect(values.rules).toEqual({ word_count: { min: 400 } })
    // A new rubric: saving creates it rather than replacing another.
    expect(values.id).toBe('')
  })

  it('remembers what the scanner wrote, per criterion', () => {
    const { suggestions } = scannedToBuilderValues(SCANNED_RUBRIC)
    expect(suggestions.hypothesis.question).toBe('How clear and testable is the hypothesis?')
    expect(suggestions.hypothesis.tips[2]).toBe('Keep it up: link your conclusion back to it.')
    expect(suggestions.includes_a_title.tips).toEqual([])
  })

  it('leaves out an empty word range', () => {
    const { values } = scannedToBuilderValues({ ...SCANNED_RUBRIC, word_count: null })
    expect(values.rules).toEqual({})
  })

  it('makes a rubric the app can save once it is filled in', () => {
    const { values } = scannedToBuilderValues(SCANNED_RUBRIC)
    const rubric = valuesToRubric(values, 'lab_1')
    expect(rubric.source).toBe('mine')
    expect(rubric.criteria).toHaveLength(2)
    expect(rubric.checklist).toEqual([
      {
        id: 'includes_a_title',
        name: 'Includes a title',
        question: 'Does the report have a title?',
      },
    ])
  })
})

describe('isSuggested', () => {
  it('is true only while the field still holds the suggestion', () => {
    expect(isSuggested('Keep it up.', 'Keep it up.')).toBe(true)
    expect(isSuggested('Keep it up!', 'Keep it up.')).toBe(false)
    expect(isSuggested('', '')).toBe(false)
    expect(isSuggested('anything', undefined)).toBe(false)
  })
})

describe('preparePhoto', () => {
  it('sends small JPG, PNG and WebP photos unchanged', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const file = new File([bytes], 'rubric.png', { type: 'image/png' })
    expect(await preparePhoto(file)).toBe(btoa(String.fromCharCode(...bytes)))
  })

  it('refuses files that are not photos', async () => {
    const file = new File(['%PDF-1.7'], 'rubric.pdf', { type: 'application/pdf' })
    await expect(preparePhoto(file)).rejects.toThrow(PhotoError)
    await expect(preparePhoto(file)).rejects.toThrow('rubric.pdf isn’t a photo')
  })

  it('explains when the browser can’t open a photo', async () => {
    // jsdom can't decode images, like a browser that doesn't support HEIC.
    const file = new File([new Uint8Array(10)], 'IMG_0001.heic', { type: 'image/heic' })
    await expect(preparePhoto(file)).rejects.toThrow('This browser can’t open IMG_0001.heic')
  })
})
