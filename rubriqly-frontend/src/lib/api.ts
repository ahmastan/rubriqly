import type { Account } from './auth'
import { buildCheckResult, rubricForScoring } from './checkResult'
import { apiFetch } from './http'
import { clearData, loadData, newId, updateData } from './localStore'
import { STARTER_RUBRICS } from './starterRubrics'
import { countWords, extractTitle, splitParagraphs } from './text'
import { getThemePreference } from './theme'
import type {
  Assignment,
  CheckResponse,
  CheckView,
  NewCheckInput,
  Rubric,
  ScanQuota,
  ScanResponse,
} from './types'

// The one place screens get data from. Drafts, checks and rubrics are stored on this device
// (per account, see localStore). Only the text being checked goes to the backend, which returns
// scores; the result is built and saved here.

/**
 * The privacy notice shown where drafts are checked. It must describe what really happens.
 */
export const PRIVACY_NOTICE =
  'Drafts are saved on this computer. To score a draft, its text is sent to Rubriqly’s server and to Vercel AI Gateway, where it isn’t used for training and isn’t kept by Rubriqly. Rubriqly never writes anything for you.'

export async function listRubrics(): Promise<Rubric[]> {
  return [...STARTER_RUBRICS, ...loadData().rubrics]
}

export async function getRubric(id: string): Promise<Rubric> {
  const rubric = (await listRubrics()).find((r) => r.id === id)
  if (!rubric) throw new Error(`Rubric "${id}" not found`)
  return rubric
}

export async function saveRubric(rubric: Rubric): Promise<Rubric> {
  const saved: Rubric = { ...rubric, source: 'mine' }
  updateData((data) => {
    const existing = data.rubrics.findIndex((r) => r.id === saved.id)
    if (existing >= 0) {
      saved.version = data.rubrics[existing].version + 1
      data.rubrics[existing] = saved
    } else {
      data.rubrics.push(saved)
    }
  })
  return saved
}

/** Shown where rubric photos are chosen. It must describe what really happens. */
export const SCAN_PRIVACY_NOTICE =
  'Your photos are sent to Rubriqly’s server and to Vercel AI Gateway, where Google’s Gemini model reads them. They aren’t used for training and aren’t kept by Rubriqly. Leave out names and scores.'

export const SCAN_QUOTA_KEY = ['scan-quota'] as const

export async function getScanQuota(): Promise<ScanQuota> {
  return apiFetch<ScanQuota>('/api/rubric-scans/quota')
}

/** Reads rubric photos (base64, from `preparePhoto`). Nothing is saved until the builder saves. */
export async function scanRubric(photos: string[]): Promise<ScanResponse> {
  return apiFetch<ScanResponse>('/api/rubric-scans', {
    method: 'POST',
    body: { images: photos.map((data) => ({ data })) },
  })
}

export interface AssignmentSummary extends Assignment {
  draftCount: number
  /** Check ids, oldest first. */
  checkIds: string[]
  latestCheckId?: string
  /** When the latest check ran, for sorting by recent activity. */
  updatedAt: string
}

export async function listAssignments(): Promise<AssignmentSummary[]> {
  const data = loadData()
  return data.assignments
    .map((a) => {
      const checks = data.checks
        .filter((c) => c.assignmentId === a.id)
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
      const latest = checks.at(-1)
      return {
        ...a,
        draftCount: data.drafts.filter((d) => d.assignmentId === a.id).length,
        checkIds: checks.map((c) => c.id),
        latestCheckId: latest?.id,
        updatedAt: latest?.createdAt ?? a.createdAt,
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function runCheck(input: NewCheckInput): Promise<{ checkId: string }> {
  const rubric = await getRubric(input.rubricId)
  // Nothing is saved unless scoring succeeds: a failed check leaves no draft behind.
  const response = await apiFetch<CheckResponse>('/api/checks', {
    method: 'POST',
    body: { rubric: rubricForScoring(rubric), prompt: input.prompt, text: input.text },
  })

  const now = new Date().toISOString()
  let checkId = ''
  updateData((data) => {
    let assignment = data.assignments.find((a) => a.id === input.assignmentId)
    if (!assignment) {
      const { title } = extractTitle(splitParagraphs(input.text))
      assignment = {
        id: newId('asg'),
        name: title ?? 'Untitled assignment',
        prompt: input.prompt,
        rubricId: rubric.id,
        createdAt: now,
      }
      data.assignments.push(assignment)
    } else {
      assignment.prompt = input.prompt
      assignment.rubricId = rubric.id
    }

    const versionNumber = data.drafts.filter((d) => d.assignmentId === assignment.id).length + 1
    const draft = {
      id: newId('drf'),
      assignmentId: assignment.id,
      versionNumber,
      text: input.text,
      wordCount: countWords(input.text),
      createdAt: now,
    }
    data.drafts.push(draft)

    const check = buildCheckResult(rubric, input.text, response, {
      id: newId('chk'),
      draftId: draft.id,
      assignmentId: assignment.id,
    })
    data.checks.push(check)
    checkId = check.id
  })
  return { checkId }
}

export async function getCheck(id: string): Promise<CheckView> {
  const data = loadData()
  const check = data.checks.find((c) => c.id === id)
  if (!check) throw new Error('This check was not found on this device.')
  const assignment = data.assignments.find((a) => a.id === check.assignmentId)
  const draft = data.drafts.find((d) => d.id === check.draftId)
  if (!assignment || !draft) throw new Error('This check’s draft is missing from this device.')

  // Only compare checks scored with the same rubric version, so the change is meaningful.
  const comparable = data.checks
    .filter(
      (c) =>
        c.assignmentId === check.assignmentId &&
        c.rubricId === check.rubricId &&
        c.rubricVersion === check.rubricVersion &&
        c.createdAt <= check.createdAt,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const index = comparable.findIndex((c) => c.id === check.id)
  const previousCheck = index > 0 ? comparable[index - 1] : undefined
  const previousDraft = previousCheck && data.drafts.find((d) => d.id === previousCheck.draftId)

  return {
    check,
    assignment,
    draft,
    previous:
      previousCheck && previousDraft ? { check: previousCheck, draft: previousDraft } : undefined,
    history: comparable.slice(0, index + 1).map((c) => c.overall.value),
  }
}

/** Everything Rubriqly keeps for this account on this device, for "Export my data". */
export function exportLocalData(account?: Account) {
  return {
    app: 'rubriqly',
    exportedAt: new Date().toISOString(),
    account: account && {
      email: account.email,
      displayName: account.displayName,
      createdAt: account.createdAt,
    },
    theme: getThemePreference(),
    ...loadData(),
  }
}

/** "Delete all data on this device": this account's drafts, checks and rubrics. */
export async function deleteLocalData(): Promise<void> {
  clearData()
}

/** Delete an assignment ("chat") with all its drafts and check results from this device. */
export async function deleteAssignment(id: string): Promise<{ checkIds: string[] }> {
  let checkIds: string[] = []
  updateData((data) => {
    checkIds = data.checks.filter((c) => c.assignmentId === id).map((c) => c.id)
    data.checks = data.checks.filter((c) => c.assignmentId !== id)
    data.drafts = data.drafts.filter((d) => d.assignmentId !== id)
    data.assignments = data.assignments.filter((a) => a.id !== id)
  })
  return { checkIds }
}
