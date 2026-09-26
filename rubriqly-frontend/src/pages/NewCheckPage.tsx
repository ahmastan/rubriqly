import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ChevronDown, Loader2, Lock, Paperclip, Plus, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import {
  listAssignments,
  listRubrics,
  PRIVACY_NOTICE,
  runCheck,
  type AssignmentSummary,
} from '../lib/api'
import { ACCOUNT_KEY } from '../lib/auth'
import { FileReadError, readDraftFile } from '../lib/fileText'
import { useSlow } from '../lib/hooks'
import { ApiError } from '../lib/http'
import { countWords } from '../lib/text'
import type { Rubric } from '../lib/types'
import { cn } from '../lib/ui'

/** Same as the backend's MAX_WORDS (which has the final say). */
const MAX_DRAFT_WORDS = 10000
const NEW_ASSIGNMENT = 'new'

const schema = z.object({
  rubricId: z.string().min(1, 'Choose a rubric.'),
  prompt: z.string().max(4000, 'Keep the prompt under 4,000 characters.'),
  text: z
    .string()
    .refine((t) => countWords(t) > 0, 'Paste or upload your draft first.')
    .refine(
      (t) => countWords(t) <= MAX_DRAFT_WORDS,
      `Drafts can be up to ${MAX_DRAFT_WORDS.toLocaleString()} words.`,
    ),
  assignmentId: z.string(),
})

type FormValues = z.infer<typeof schema>

export function NewCheckPage() {
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: listRubrics })
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: listAssignments })

  // The form reads its starting rubric and assignment once, so wait until their options exist.
  if (!rubrics.data || !assignments.data) {
    return (
      <p role="status" className="m-0 p-10 text-center text-sm text-ink-2">
        Loading…
      </p>
    )
  }
  return <Composer rubrics={rubrics.data} assignments={assignments.data} />
}

function Composer({
  rubrics,
  assignments,
}: {
  rubrics: Rubric[]
  assignments: AssignmentSummary[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [promptOpen, setPromptOpen] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string>()
  const [uploadNote, setUploadNote] = useState<string>()
  const [readingFile, setReadingFile] = useState<string>()
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftId = useId()

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      rubricId: rubrics.find((r) => r.id === params.get('rubric'))?.id ?? rubrics[0]?.id ?? '',
      prompt: '',
      text: '',
      assignmentId:
        assignments.find((a) => a.id === params.get('assignment'))?.id ?? NEW_ASSIGNMENT,
    },
  })

  const [rubricId, text, assignmentId] = useWatch({
    control,
    name: ['rubricId', 'text', 'assignmentId'],
  })
  const selectedRubric = rubrics.find((r) => r.id === rubricId)
  const words = countWords(text)
  const assignment = assignments.find((a) => a.id === assignmentId)
  const draftNumber = (assignment?.draftCount ?? 0) + 1

  const check = useMutation({
    mutationFn: runCheck,
    onSuccess: ({ checkId }) => {
      void queryClient.invalidateQueries({ queryKey: ['assignments'] })
      navigate(`/checks/${checkId}`)
    },
    onError: (error) => {
      // The session ended (signed out elsewhere, or expired): the app shell sends them to sign in.
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(ACCOUNT_KEY, null)
      }
    },
  })
  const slow = useSlow(check.isPending, 8000)

  const onSubmit = (values: FormValues) =>
    check.mutate({
      rubricId: values.rubricId,
      prompt: values.prompt.trim(),
      text: values.text,
      assignmentId: values.assignmentId === NEW_ASSIGNMENT ? undefined : values.assignmentId,
    })

  const onFile = async (file: File | undefined) => {
    setUploadMessage(undefined)
    setUploadNote(undefined)
    if (!file) return
    setReadingFile(file.name)
    try {
      const draft = await readDraftFile(file)
      setValue('text', draft.text, { shouldValidate: true, shouldDirty: true })
      const count = `${draft.paragraphs} paragraph${draft.paragraphs === 1 ? '' : 's'}`
      setUploadNote(
        draft.approximate
          ? `Read ${count} from ${file.name}. PDF layouts vary, so check the paragraph breaks below.`
          : `Read ${count} from ${file.name}.`,
      )
    } catch (error) {
      setUploadMessage(
        error instanceof FileReadError
          ? error.message
          : 'We couldn’t read that file. Try another file, or paste the text.',
      )
    } finally {
      setReadingFile(undefined)
    }
  }

  // Cmd/Ctrl + Enter submits, like most AI apps.
  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      formRef.current?.requestSubmit()
    }
  }

  const error = errors.text?.message ?? errors.prompt?.message ?? errors.rubricId?.message

  return (
    <div className="flex grow flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-[760px] flex-col gap-5">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="m-0 text-[30px] font-semibold tracking-[-0.02em]">Check a draft</h1>
          <p className="m-0 max-w-md text-[15px] leading-normal text-ink-2">
            Paste a draft and pick a rubric to see where to revise. Rubriqly never writes anything
            for you.
          </p>
        </div>

        <form
          ref={formRef}
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          aria-busy={check.isPending}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-col rounded-2xl border border-border bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.05)] transition-colors focus-within:border-field-border">
            {promptOpen && (
              <div className="flex flex-col gap-1.5 border-b border-divider px-5 pt-4 pb-3">
                <div className="flex items-center">
                  <label
                    htmlFor={`${draftId}-prompt`}
                    className="grow text-xs font-medium text-ink-2"
                  >
                    Assignment prompt · optional, helps Jev judge whether you answered the question
                  </label>
                  <button
                    type="button"
                    aria-label="Remove assignment prompt"
                    onClick={() => {
                      setValue('prompt', '')
                      setPromptOpen(false)
                    }}
                    className="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-2 hover:bg-muted hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                </div>
                <textarea
                  id={`${draftId}-prompt`}
                  rows={2}
                  {...register('prompt')}
                  className="field-sizing-content max-h-40 min-h-12 w-full resize-none border-0 bg-transparent p-0 text-sm leading-normal text-ink outline-none placeholder:text-ink-2"
                  placeholder="Paste the assignment prompt"
                />
              </div>
            )}

            <textarea
              id={draftId}
              aria-label="Your draft"
              aria-describedby={`${draftId}-meta`}
              aria-invalid={errors.text ? true : undefined}
              rows={6}
              placeholder="Paste your draft here. Leave a blank line between paragraphs."
              onKeyDown={onDraftKeyDown}
              {...register('text')}
              className="field-sizing-content max-h-[50vh] min-h-40 w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 font-serif text-[17px] leading-[1.6] text-ink-body outline-none placeholder:font-sans placeholder:text-[15px] placeholder:text-ink-2"
            />

            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-1 pb-3">
              <ChipSelect label="Rubric" {...register('rubricId')}>
                {rubrics.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </ChipSelect>

              <button
                type="button"
                aria-label="Upload a file (.docx, .pdf or .txt, up to 5 MB)"
                title="Upload a file"
                onClick={() => fileInputRef.current?.click()}
                className={chip}
              >
                <Paperclip size={15} aria-hidden="true" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                aria-label="Upload a draft file"
                accept=".txt,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  void onFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />

              {!promptOpen && (
                <button type="button" onClick={() => setPromptOpen(true)} className={chip}>
                  <Plus size={14} aria-hidden="true" />
                  Prompt
                </button>
              )}

              <ChipSelect label={`Draft ${draftNumber} of`} showLabel {...register('assignmentId')}>
                <option value={NEW_ASSIGNMENT}>a new assignment</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </ChipSelect>

              <span className="grow" />
              <span
                id={`${draftId}-meta`}
                aria-live="polite"
                className="px-1 font-mono text-xs text-ink-2"
              >
                {words.toLocaleString()} words
              </span>
              <button
                type="submit"
                aria-label={check.isPending ? 'Checking draft' : 'Check draft'}
                title="Check draft (Ctrl or ⌘ + Enter)"
                disabled={check.isPending}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-ink text-bg transition-colors hover:bg-ink/85 disabled:cursor-wait disabled:opacity-70"
              >
                {check.isPending ? (
                  <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowUp size={17} strokeWidth={2.2} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {readingFile && (
            <p role="status" className="m-0 px-1 text-[13px] text-ink-2">
              Reading {readingFile}…
            </p>
          )}
          {uploadNote && !readingFile && !check.isPending && (
            <p role="status" className="m-0 px-1 text-[13px] text-ink-2">
              {uploadNote}
            </p>
          )}
          {check.isPending && (
            <p role="status" className="m-0 px-1 text-[13px] text-ink-2">
              Checking your draft against {selectedRubric?.title ?? 'the rubric'}…
              {slow && ' The server may be waking up; this can take a minute or two.'}
            </p>
          )}
          {(error || uploadMessage || check.isError) && (
            <p role="alert" className="m-0 rounded-xl bg-warn-bg px-3.5 py-2 text-[13px] text-warn">
              {error ?? uploadMessage ?? check.error?.message}
            </p>
          )}
        </form>

        <p className="m-0 flex items-start justify-center gap-2 text-center text-xs leading-normal text-ink-2">
          <Lock size={13} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{PRIVACY_NOTICE}</span>
        </p>

        {selectedRubric && <RubricDetails rubric={selectedRubric} />}
      </div>
    </div>
  )
}

const chip =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-transparent px-2.5 text-[13px] text-ink-soft transition-colors hover:bg-muted hover:text-ink'

/** A native <select> styled as a pill, so it stays keyboard and screen reader friendly. */
function ChipSelect({
  label,
  showLabel = false,
  children,
  ...props
}: {
  label: string
  showLabel?: boolean
  children: ReactNode
} & React.ComponentProps<'select'>) {
  return (
    <label className={cn(chip, 'relative pr-7')}>
      <span className={showLabel ? 'text-ink-2' : 'sr-only'}>{label}</span>
      <select
        {...props}
        className="max-w-44 cursor-pointer appearance-none truncate border-0 bg-transparent p-0 text-[13px] font-medium text-ink outline-none"
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 text-ink-2"
        aria-hidden="true"
      />
    </label>
  )
}

function RubricDetails({ rubric }: { rubric: Rubric }) {
  const ruleCount = rubric.rules.word_count ? ' plus word count' : ''
  return (
    <details className="group rounded-2xl border border-border bg-surface px-5 py-3.5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        <span className="grow">
          <span className="font-medium">What gets checked</span>{' '}
          <span className="text-ink-2">
            · {rubric.title} · {rubric.source === 'builtin' ? 'built-in' : 'your rubric'} v
            {rubric.version}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="text-ink-2 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-3.5 flex flex-col gap-3.5 border-t border-divider pt-3.5">
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rubric.criteria.map((c) => (
            <PreviewRow
              key={c.id}
              type="score"
              name={c.name}
              desc={rubric.summaries?.[c.id] ?? c.question}
            />
          ))}
          {(rubric.checklist.length > 0 || ruleCount) && (
            <PreviewRow
              type="check"
              name="Checklist"
              desc={`${rubric.checklist.length} yes/no requirement${rubric.checklist.length === 1 ? '' : 's'}${ruleCount}`}
            />
          )}
        </ul>
        <p className="m-0 text-xs leading-normal text-ink-2">
          Each paragraph is also checked for a claim, evidence and analysis, so results point to
          where to revise.{' '}
          <Link to={`/rubrics/${rubric.id}/edit`} className="no-underline">
            Open in the builder
          </Link>
        </p>
      </div>
    </details>
  )
}

function PreviewRow({ type, name, desc }: { type: string; name: string; desc: string }) {
  return (
    <li className="flex gap-2.5 text-[13px] leading-[1.45]">
      <span className="shrink-0 self-start rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-4 text-ink-soft">
        {type}
      </span>
      <span>
        <strong className="font-semibold">{name}</strong> <span className="text-ink-2">{desc}</span>
      </span>
    </li>
  )
}
