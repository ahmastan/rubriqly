// Shapes shared by the screens. They mirror the planned backend API (brief sections 6–8),
// so swapping the mock layer for real API calls later keeps the same types.

export interface ScoreCriterion {
  id: string
  name: string
  type: 'score'
  weight: number
  /** Sent to Jev as the question's instructions. */
  question: string
  /** One per level, lowest first. Sent to Jev. */
  descriptors: string[]
  /** One per level, lowest first. Shown to students, never sent to Jev. */
  tips: string[]
}

export interface ChecklistItem {
  id: string
  name: string
  /** A yes/no question, sent to Jev as a `boolean` question. */
  question: string
}

export interface RubricRules {
  word_count?: { min?: number; max?: number }
}

export interface Rubric {
  id: string
  version: number
  title: string
  /** `builtin` = ships with Rubriqly, `mine` = created in the builder. */
  source: 'builtin' | 'mine'
  levels: string[]
  criteria: ScoreCriterion[]
  checklist: ChecklistItem[]
  rules: RubricRules
  /** Short descriptions for the "What gets checked" panel. */
  summaries?: Record<string, string>
}

export interface Assignment {
  id: string
  name: string
  course?: string
  prompt: string
  rubricId: string
  createdAt: string
}

export interface Draft {
  id: string
  assignmentId: string
  versionNumber: number
  text: string
  wordCount: number
  createdAt: string
}

export interface ParagraphTag {
  label: string
  present: boolean
}

export interface ParagraphResult {
  /** 1-based paragraph number shown as ¶n. */
  n: number
  text: string
  isIntro: boolean
  /** The last paragraph of a draft with 3 or more; like the intro, it's never marked weak. */
  isConclusion?: boolean
  tags: ParagraphTag[]
  /** Missing evidence or analysis: lightly highlighted so the student knows where to revise. */
  weak: boolean
}

export interface CriterionResult {
  criterionId: string
  name: string
  /** 1-based level, already rounded and clamped. */
  level: number
  levelName: string
  confidence: number
  /** Below the confidence threshold: "check this yourself". */
  lowConfidence: boolean
  /** The rubric author's tip for this level, shown for weaker criteria. */
  tip?: string
}

export interface ChecklistResult {
  id: string
  label: string
  passed: boolean
  /** `model` = Jev yes/no probability, `rule` = counted in plain code. */
  source: 'model' | 'rule'
  probability?: number
}

export interface OverallEstimate {
  /** Weighted average level, e.g. 2.9. */
  value: number
  /** Rounded level, 1-based. */
  level: number
  levelName: string
  levelCount: number
}

export interface CheckResult {
  id: string
  draftId: string
  assignmentId: string
  rubricId: string
  rubricVersion: number
  rubricTitle: string
  createdAt: string
  title?: string
  wordCount: number
  paragraphs: ParagraphResult[]
  criteria: CriterionResult[]
  checklist: ChecklistResult[]
  overall: OverallEstimate
  /** `mock` = a demo result saved before accounts existed; otherwise the model that scored it. */
  model: string
}

export interface CheckView {
  check: CheckResult
  assignment: Assignment
  draft: Draft
  /** The previous check of the same assignment with the same rubric version, if any. */
  previous?: { check: CheckResult; draft: Draft }
  /** Overall values of every check of this assignment with the same rubric version, oldest first. */
  history: number[]
}

/** What `POST /api/checks` returns: scores only. The browser adds tips and the overall. */
export interface CheckResponse {
  model: string
  word_count: number
  title: string | null
  criteria: {
    id: string
    /** 1-based and unrounded, e.g. 3.65. */
    level: number
    confidence: number
    probabilities: number[]
  }[]
  checklist: { id: string; probability: number }[]
  paragraphs: {
    n: number
    is_intro: boolean
    is_conclusion: boolean
    tags: { label: string; present: boolean; probability: number }[]
    weak: boolean
  }[]
}

export interface NewCheckInput {
  rubricId: string
  /** Omit to start a new assignment. */
  assignmentId?: string
  prompt: string
  text: string
}

/** A rubric read from photos by `POST /api/rubric-scans`. Levels and lists are lowest first. */
export interface ScannedRubric {
  title: string
  levels: string[]
  criteria: {
    name: string
    /** Copied from the rubric; empty when the cell was empty. */
    descriptors: string[]
    /** Written by the scanner, not on the rubric: shown as "Suggested" until edited. */
    suggested_question: string
    suggested_tips: string[]
  }[]
  checklist: { name: string; suggested_question: string }[]
  word_count: { min: number | null; max: number | null } | null
  /** What the scanner couldn't read or wasn't sure about. */
  notes: string
}

/** Scans left: `used` of `limit` in the last 7 days. */
export interface ScanQuota {
  /** False when the server can't read photos right now (scanning isn't switched on). */
  available: boolean
  used: number
  limit: number
  /** When the oldest counted scan leaves the 7 days (ISO), if any count. */
  next_free_at: string | null
}

export interface ScanResponse {
  rubric: ScannedRubric
  /** `mock` = the free demo scanner (a fixed example, not the student's photo). */
  model: string
  quota: ScanQuota
}
