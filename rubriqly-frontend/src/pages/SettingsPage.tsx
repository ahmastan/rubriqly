import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, LogOut, Monitor, Moon, Sun, Trash2 } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Avatar } from '../components/Sidebar'
import { deleteLocalData, exportLocalData, PRIVACY_NOTICE } from '../lib/api'
import { downloadFile } from '../lib/download'
import { ACCOUNT_KEY, changePassword, deleteAccount, signOut, updateDisplayName } from '../lib/auth'
import { useAccount, useThemePreference } from '../lib/hooks'
import { setThemePreference, type ThemePreference } from '../lib/theme'
import { buttonStyles, cn, fieldStyles, pageBar } from '../lib/ui'

export function SettingsPage() {
  return (
    <div className="flex grow flex-col">
      <div className={pageBar}>
        <h1 className="m-0 text-base font-semibold">Settings</h1>
      </div>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
        <AccountSection />
        <PasswordSection />
        <AppearanceSection />
        <DataSection />
        <DeleteAccountSection />
        <AboutSection />
      </div>
    </div>
  )
}

function Card({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="m-0 text-[15px] font-semibold">
          {title}
        </h2>
        {description && <p className="m-0 text-[13px] leading-normal text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function AccountSection() {
  const account = useAccount().data
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState(account?.displayName ?? '')
  const saveName = useMutation({
    mutationFn: () => updateDisplayName(name),
    onSuccess: (updated) => queryClient.setQueryData(ACCOUNT_KEY, updated),
  })
  const leave = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries()
      queryClient.setQueryData(ACCOUNT_KEY, null)
      navigate('/signin', { replace: true })
    },
  })
  if (!account) return null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    saveName.mutate()
  }

  return (
    <Card title="Account" description={`Signed in as ${account.email}.`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Avatar name={name} size="lg" />
        <label className="flex grow flex-col gap-1.5 text-[13px] font-medium">
          Display name
          <input
            type="text"
            value={name}
            required
            maxLength={60}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value)
              saveName.reset()
            }}
            className={cn(fieldStyles, 'h-10 text-sm font-normal')}
          />
        </label>
        <button
          type="submit"
          disabled={name.trim() === account.displayName || saveName.isPending}
          className={buttonStyles.primary}
        >
          Save
        </button>
      </form>
      {saveName.isSuccess && (
        <p role="status" className="m-0 text-[13px] text-accent">
          Saved.
        </p>
      )}
      {saveName.isError && <Problem message={saveName.error.message} />}
      <div className="flex flex-col gap-3 border-t border-divider pt-4 sm:flex-row sm:items-center">
        <p className="m-0 grow text-sm">Sign out of Rubriqly on this device.</p>
        <button type="button" onClick={() => leave.mutate()} className={buttonStyles.secondary}>
          <LogOut size={15} aria-hidden="true" />
          Sign out
        </button>
      </div>
      {leave.isError && <Problem message={leave.error.message} />}
    </Card>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
    },
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    change.mutate()
  }
  const field = cn(fieldStyles, 'h-10 text-sm font-normal')

  return (
    <Card title="Password" description="Changing it signs you out on your other devices.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Current password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value)
              change.reset()
            }}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          New password
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value)
              change.reset()
            }}
            className={field}
          />
          <span className="text-xs font-normal text-ink-2">At least 12 characters.</span>
        </label>
        <div>
          <button type="submit" disabled={change.isPending} className={buttonStyles.secondary}>
            Change password
          </button>
        </div>
      </form>
      {change.isSuccess && (
        <p role="status" className="m-0 text-[13px] text-accent">
          Password changed.
        </p>
      )}
      {change.isError && <Problem message={change.error.message} />}
    </Card>
  )
}

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className="m-0 rounded-xl bg-warn-bg px-3.5 py-2 text-[13px] text-warn">
      {message}
    </p>
  )
}

const THEMES: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={16} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Monitor size={16} aria-hidden="true" /> },
]

function AppearanceSection() {
  const preference = useThemePreference()
  return (
    <Card title="Appearance" description="System follows your device’s light or dark setting.">
      <fieldset className="m-0 grid grid-cols-3 gap-2.5 border-0 p-0">
        <legend className="sr-only">Theme</legend>
        {THEMES.map((theme) => {
          const checked = preference === theme.value
          return (
            <label
              key={theme.value}
              className={cn(
                'flex cursor-pointer flex-col gap-2.5 rounded-xl border p-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                checked ? 'border-ink' : 'border-border hover:border-field-border',
              )}
            >
              <ThemePreview theme={theme.value} />
              <span className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="radio"
                  name="theme"
                  value={theme.value}
                  checked={checked}
                  onChange={() => setThemePreference(theme.value)}
                  className="sr-only"
                />
                {theme.icon}
                {theme.label}
              </span>
            </label>
          )
        })}
      </fieldset>
    </Card>
  )
}

/** A tiny drawing of the app in each theme: sidebar, lines of text and a blue level bar. */
function ThemePreview({ theme }: { theme: ThemePreference }) {
  const pane = (dark: boolean) => (
    <span className={cn('flex h-full grow gap-1 p-1.5', dark ? 'bg-[#141517]' : 'bg-[#f7f6f2]')}>
      <span className={cn('w-1/4 rounded-sm', dark ? 'bg-[#2e2150]' : 'bg-[#eee8f8]')} />
      <span className="flex grow flex-col gap-1">
        <span className={cn('h-1.5 w-3/4 rounded-full', dark ? 'bg-[#3a3c42]' : 'bg-[#d6d5ce]')} />
        <span className={cn('h-1.5 w-1/2 rounded-full', dark ? 'bg-[#3a3c42]' : 'bg-[#d6d5ce]')} />
        <span
          className={cn('mt-auto h-1.5 w-2/3 rounded-full', dark ? 'bg-[#8fa8e8]' : 'bg-[#1e3a8a]')}
        />
      </span>
    </span>
  )
  return (
    <span aria-hidden="true" className="flex h-16 overflow-hidden rounded-lg border border-divider">
      {theme === 'system' ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(theme === 'dark')
      )}
    </span>
  )
}

function DataSection() {
  const account = useAccount().data
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const remove = useMutation({
    mutationFn: deleteLocalData,
    onSuccess: () => {
      setConfirming(false)
      void queryClient.invalidateQueries()
    },
  })

  const onExport = () => {
    downloadFile(
      JSON.stringify(exportLocalData(account ?? undefined), null, 2),
      `rubriqly-data-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    )
  }

  return (
    <Card title="Data & privacy" description={PRIVACY_NOTICE}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <p className="m-0 grow text-sm">
          Download your drafts, results, rubrics and settings as a JSON file.
        </p>
        <button type="button" onClick={onExport} className={buttonStyles.secondary}>
          <Download size={15} aria-hidden="true" />
          Export my data
        </button>
      </div>
      <div className="flex flex-col gap-3 border-t border-divider pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <p className="m-0 grow text-sm">
            Delete every draft, result and rubric saved for your account on this device.
          </p>
          {!confirming && (
            <button
              type="button"
              onClick={() => {
                remove.reset()
                setConfirming(true)
              }}
              className={buttonStyles.danger}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete all data
            </button>
          )}
        </div>
        {confirming && (
          <div
            role="alertdialog"
            aria-labelledby="confirm-delete"
            className="flex flex-col gap-3 rounded-xl bg-danger-bg p-4 sm:flex-row sm:items-center"
          >
            <p id="confirm-delete" className="m-0 grow text-sm text-danger">
              This can’t be undone. Export your data first if you want a copy.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                className={buttonStyles.secondary}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => remove.mutate()}
                className={buttonStyles.dangerSolid}
              >
                Delete everything
              </button>
            </div>
          </div>
        )}
        {remove.isSuccess && (
          <p role="status" className="m-0 text-[13px] text-ink-2">
            Your drafts, results and rubrics were deleted from this device.
          </p>
        )}
      </div>
    </Card>
  )
}

function DeleteAccountSection() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const remove = useMutation({
    mutationFn: () => deleteAccount(password),
    onSuccess: () => {
      queryClient.removeQueries()
      queryClient.setQueryData(ACCOUNT_KEY, null)
      navigate('/', { replace: true })
    },
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    remove.mutate()
  }

  return (
    <Card
      title="Delete account"
      description="Deletes your account from Rubriqly’s server, and your drafts, results and rubrics from this device. Drafts saved on other devices stay there until you delete them."
    >
      {!confirming ? (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className={buttonStyles.danger}>
            <Trash2 size={15} aria-hidden="true" />
            Delete my account
          </button>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          aria-labelledby="confirm-delete-account"
          className="flex flex-col gap-3 rounded-xl bg-danger-bg p-4"
        >
          <p id="confirm-delete-account" className="m-0 text-sm text-danger">
            This can’t be undone. Enter your password to confirm.
          </p>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                remove.reset()
              }}
              className={cn(fieldStyles, 'h-10 text-sm font-normal')}
            />
          </label>
          {remove.isError && <Problem message={remove.error.message} />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                setPassword('')
                remove.reset()
              }}
              className={buttonStyles.secondary}
            >
              Cancel
            </button>
            <button type="submit" disabled={remove.isPending} className={buttonStyles.dangerSolid}>
              {remove.isPending ? 'Deleting…' : 'Delete account'}
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}

function AboutSection() {
  return (
    <Card title="About">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-2">Version</dt>
        <dd className="m-0 font-mono text-[13px]">0.1.0</dd>
        <dt className="text-ink-2">Scoring</dt>
        <dd className="m-0">
          Jev by TypeSafe AI, through Vercel AI Gateway. Results are estimated levels, not grades.
        </dd>
      </dl>
    </Card>
  )
}
