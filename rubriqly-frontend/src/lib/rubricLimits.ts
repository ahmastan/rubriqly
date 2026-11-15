import type { Rubric } from './types'

/**
 * The most a rubric can hold and still be checked. These match the backend's `RubricIn`
 * (rubriqly-backend/src/rubriqly/scoring/compile.py); keep the two in sync.
 */
export const RUBRIC_LIMITS = {
  /** Rubric, criterion, checklist item and level names. */
  name: 120,
  /** Questions for Jev and level descriptions. */
  text: 600,
  levels: 8,
  criteria: 12,
  checklist: 15,
} as const

/** Length in characters as the server counts them (code points, so an emoji counts once). */
export const charCount = (text: string) => [...text].length

const over = (text: string, max: number) => charCount(text.trim()) > max

/**
 * Why this rubric can't be checked as it is, in words a student can act on, or undefined when
 * it fits. Rubrics saved before the builder enforced the limits can be too big.
 */
export function rubricProblem(rubric: Rubric): string | undefined {
  const L = RUBRIC_LIMITS
  const fix = 'Edit the rubric to shorten it, then check again.'
  if (rubric.criteria.length > L.criteria)
    return `This rubric has ${rubric.criteria.length} score criteria; the most that can be checked is ${L.criteria}. ${fix}`
  if (rubric.checklist.length > L.checklist)
    return `This rubric has ${rubric.checklist.length} yes/no questions; the most that can be checked is ${L.checklist}. ${fix}`
  if (rubric.levels.length > L.levels)
    return `This rubric has ${rubric.levels.length} levels; the most that can be checked is ${L.levels}. ${fix}`
  if (over(rubric.title, L.name) || rubric.levels.some((l) => over(l, L.name)))
    return `This rubric’s name or a level name is longer than ${L.name} characters. ${fix}`
  const tooLong = (i: { name: string; question: string }, descriptors: string[] = []) =>
    over(i.name, L.name) || over(i.question, L.text) || descriptors.some((d) => over(d, L.text))
  const long =
    rubric.criteria.find((c) => tooLong(c, c.descriptors)) ??
    rubric.checklist.find((c) => tooLong(c))
  if (long)
    return `“${[...long.name.trim()].slice(0, 60).join('')}” has a name over ${L.name} characters, or a question or level description over ${L.text}. ${fix}`
  return undefined
}
