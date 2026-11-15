import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Library,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, useMatch, useNavigate } from 'react-router'
import { deleteAssignment, listAssignments, type AssignmentSummary } from '../lib/api'
import { useAccount, useThemePreference } from '../lib/hooks'
import { initials } from '../lib/text'
import { resolveTheme, setThemePreference } from '../lib/theme'
import { cn } from '../lib/ui'
import { ConfirmDialog } from './ConfirmDialog'
import { Logo, LogoMark } from './Logo'

const item =
  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink-soft no-underline transition-colors hover:bg-muted hover:text-ink'
const activeItem = 'bg-selected font-medium text-ink hover:bg-selected'

export function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  onClose,
}: {
  collapsed?: boolean
  /** Desktop only: collapse to an icon rail. */
  onToggleCollapsed?: () => void
  /** Mobile drawer only: close the drawer. */
  onClose?: () => void
}) {
  const assignments = useQuery({ queryKey: ['assignments'], queryFn: listAssignments })
  const checkMatch = useMatch('/checks/:checkId')
  const currentCheck = checkMatch?.params.checkId
  const account = useAccount()
  const displayName = account.data?.displayName ?? ''
  const theme = useThemePreference()
  const isDark = resolveTheme(theme) === 'dark'
  const name = displayName || 'Your account'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState<AssignmentSummary>()

  const remove = useMutation({
    mutationFn: (a: AssignmentSummary) => deleteAssignment(a.id),
    onSuccess: ({ checkIds }) => {
      setPendingDelete(undefined)
      // Leave the results page if it belonged to what was just deleted.
      if (currentCheck && checkIds.includes(currentCheck)) navigate('/check/new')
      checkIds.forEach((id) => queryClient.removeQueries({ queryKey: ['check', id] }))
      void queryClient.invalidateQueries({ queryKey: ['assignments'] })
    },
  })

  return (
    <nav aria-label="Main" className="flex h-full min-h-0 flex-col gap-1 bg-chrome p-2.5">
      <div
        className={cn('flex h-11 items-center gap-2 px-1.5', collapsed && 'justify-center px-0')}
      >
        {collapsed ? <LogoMark /> : <Logo />}
        {!collapsed && <span className="grow" />}
        {onToggleCollapsed && !collapsed && (
          <IconButton label="Collapse sidebar" onClick={onToggleCollapsed}>
            <PanelLeftClose size={18} />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Close menu" onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
      </div>
      {collapsed && onToggleCollapsed && (
        <div className="flex justify-center">
          <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
            <PanelLeftOpen size={18} />
          </IconButton>
        </div>
      )}

      <Link
        to="/check/new"
        aria-label={collapsed ? 'New check' : undefined}
        title={collapsed ? 'New check' : undefined}
        className={cn(
          'mt-1 mb-2 flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-ink no-underline shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:bg-muted hover:text-ink',
          collapsed && 'justify-center px-0',
        )}
      >
        <Plus size={17} strokeWidth={2} aria-hidden="true" />
        {!collapsed && 'New check'}
      </Link>

      <NavLink
        to="/rubrics"
        end={false}
        aria-label={collapsed ? 'Rubrics' : undefined}
        title={collapsed ? 'Rubrics' : undefined}
        className={({ isActive }) =>
          cn(item, isActive && activeItem, collapsed && 'justify-center px-0')
        }
      >
        <Library size={17} strokeWidth={1.8} aria-hidden="true" />
        {!collapsed && 'Rubrics'}
      </NavLink>

      {!collapsed && (
        <section aria-labelledby="recent-heading" className="mt-4 flex min-h-0 grow flex-col">
          <h2
            id="recent-heading"
            className="m-0 px-2.5 pb-1.5 text-xs font-medium tracking-[0.02em] text-ink-2"
          >
            Recent
          </h2>
          <div className="-mx-1 min-h-0 grow overflow-y-auto px-1">
            {assignments.data && assignments.data.length === 0 && (
              <p className="m-0 px-2.5 py-1 text-[13px] leading-normal text-ink-2">
                Drafts you check will show up here.
              </p>
            )}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {assignments.data
                ?.filter((a) => a.latestCheckId)
                .map((a) => {
                  const active = currentCheck !== undefined && a.checkIds.includes(currentCheck)
                  return (
                    <li key={a.id} className="group relative">
                      <Link
                        to={`/checks/${a.latestCheckId}`}
                        aria-current={active ? 'page' : undefined}
                        className={cn(item, 'h-auto min-h-9 py-1.5 pr-9', active && activeItem)}
                      >
                        <span className="min-w-0 grow truncate">{a.name}</span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-2 group-focus-within:invisible group-hover:invisible">
                          D{a.draftCount}
                        </span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`Delete ${a.name}`}
                        title="Delete"
                        onClick={() => setPendingDelete(a)}
                        className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        </section>
      )}
      {collapsed && <span className="grow" />}

      <div
        className={cn(
          'mt-1 flex items-center gap-1 border-t border-divider pt-2',
          collapsed && 'flex-col',
        )}
      >
        <NavLink
          to="/settings"
          aria-label={collapsed ? `${name}: settings` : undefined}
          title={collapsed ? 'Settings' : undefined}
          className={({ isActive }) =>
            cn(
              'flex min-w-0 grow items-center gap-2.5 rounded-xl p-1.5 text-ink no-underline transition-colors hover:bg-muted hover:text-ink',
              isActive && 'bg-selected hover:bg-selected',
              collapsed && 'grow-0',
            )
          }
        >
          <Avatar name={displayName} />
          {!collapsed && (
            <>
              <span className="flex min-w-0 grow flex-col leading-tight">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="text-xs text-ink-2">Settings</span>
              </span>
              <Settings size={16} className="shrink-0 text-ink-2" aria-hidden="true" />
            </>
          )}
        </NavLink>
        <IconButton
          label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
        >
          {isDark ? <Sun size={17} /> : <Moon size={17} />}
        </IconButton>
      </div>
      <ConfirmDialog
        open={pendingDelete !== undefined}
        title={`Delete “${pendingDelete?.name ?? ''}”?`}
        confirmLabel={remove.isPending ? 'Deleting…' : 'Delete'}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
        onCancel={() => {
          setPendingDelete(undefined)
          remove.reset()
        }}
      >
        This deletes{' '}
        {pendingDelete?.draftCount === 1 ? 'its draft' : `all ${pendingDelete?.draftCount} drafts`}{' '}
        along with the results from this device. It can’t be undone.
        {remove.isError && (
          <span role="alert" className="mt-2 block text-warn">
            {remove.error.message}
          </span>
        )}
      </ConfirmDialog>
    </nav>
  )
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const letters = initials(name)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-accent-2-soft font-semibold text-accent-2',
        size === 'sm' ? 'size-8 text-xs' : 'size-14 text-lg',
      )}
    >
      {letters || (
        <svg
          width={size === 'sm' ? 16 : 24}
          height={size === 'sm' ? 16 : 24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
      )}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 transition-colors hover:bg-muted hover:text-ink"
    >
      {children}
    </button>
  )
}
