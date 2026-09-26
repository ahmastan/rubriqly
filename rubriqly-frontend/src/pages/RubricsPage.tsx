import { useQuery } from '@tanstack/react-query'
import { Copy, Pencil, Plus, ScanLine } from 'lucide-react'
import { Link } from 'react-router'
import { listRubrics } from '../lib/api'
import type { Rubric } from '../lib/types'
import { buttonStyles, cn, pageBar, sectionLabel } from '../lib/ui'

export function RubricsPage() {
  const rubrics = useQuery({ queryKey: ['rubrics'], queryFn: listRubrics })
  const builtin = rubrics.data?.filter((r) => r.source === 'builtin') ?? []
  const mine = rubrics.data?.filter((r) => r.source === 'mine') ?? []

  return (
    <div className="flex grow flex-col">
      <div className={pageBar}>
        <h1 className="m-0 grow text-base font-semibold">Rubrics</h1>
        <Link to="/rubrics/scan" className={buttonStyles.secondary}>
          <ScanLine size={16} strokeWidth={2} aria-hidden="true" />
          Scan a rubric
        </Link>
        <Link to="/rubrics/new" className={buttonStyles.primary}>
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          New rubric
        </Link>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-9 px-4 py-8 sm:px-8">
        <Section title="Your rubrics">
          {rubrics.isSuccess && mine.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-field-border px-5 py-6">
              <p className="m-0 text-sm text-ink-2">
                You haven’t made a rubric yet. Scan a photo of your teacher’s rubric, start from
                scratch, or copy a built-in rubric and change it to match your assignment.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to="/rubrics/scan" className={buttonStyles.secondary}>
                  <ScanLine size={15} aria-hidden="true" />
                  Scan a rubric
                </Link>
                <Link to="/rubrics/new" className={buttonStyles.secondary}>
                  <Plus size={15} aria-hidden="true" />
                  Build a rubric
                </Link>
              </div>
            </div>
          ) : (
            <CardGrid rubrics={mine} />
          )}
        </Section>
        <Section title="Built-in rubrics">
          <CardGrid rubrics={builtin} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={cn(sectionLabel, 'm-0')}>{title}</h2>
      {children}
    </section>
  )
}

function CardGrid({ rubrics }: { rubrics: Rubric[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {rubrics.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5"
        >
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-[15px] font-semibold">{r.title}</h3>
            <p className="m-0 font-mono text-xs text-ink-2">
              {r.criteria.length} criteria · {r.levels.length} levels · v{r.version}
            </p>
          </div>
          <p className="m-0 line-clamp-2 grow text-[13px] leading-normal text-ink-2">
            {r.criteria.map((c) => c.name).join(', ')}
            {r.checklist.length > 0 && ` + ${r.checklist.length} checklist items`}
          </p>
          <div className="flex gap-2">
            <Link to={`/check/new?rubric=${r.id}`} className={cn(buttonStyles.secondary, 'h-9')}>
              Use
            </Link>
            <Link
              to={`/rubrics/${r.id}/edit`}
              className={cn(buttonStyles.ghost, 'h-9')}
              aria-label={`${r.source === 'mine' ? 'Edit' : 'Copy and edit'} ${r.title}`}
            >
              {r.source === 'mine' ? (
                <Pencil size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
              {r.source === 'mine' ? 'Edit' : 'Copy & edit'}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
