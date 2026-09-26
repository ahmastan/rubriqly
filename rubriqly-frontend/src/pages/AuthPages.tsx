import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { LogoMark } from '../components/Logo'
import { ACCOUNT_KEY, MIN_AGE, safeNext, signIn, signUp, type Account } from '../lib/auth'
import { useAccount, useSlow } from '../lib/hooks'
import { buttonStyles, cn, fieldStyles } from '../lib/ui'

const field = cn(fieldStyles, 'h-11 text-[15px] font-normal')
const label = 'flex flex-col gap-1.5 text-[13px] font-medium'
const link = 'font-medium text-accent'

/** Shared by both pages: after success, forget the previous account's data and go on. */
function useFinish() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  return {
    next,
    finish: (account: Account) => {
      queryClient.removeQueries()
      queryClient.setQueryData(ACCOUNT_KEY, account)
      navigate(next, { replace: true })
    },
  }
}

function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  const account = useAccount()
  const [params] = useSearchParams()
  if (account.data) return <Navigate to={safeNext(params.get('next'))} replace />

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-4 py-12 text-ink sm:py-20">
      <Link
        to="/"
        aria-label="Rubriqly home"
        className="mb-8 flex items-center gap-2.5 rounded-lg text-ink no-underline hover:text-ink"
      >
        <LogoMark />
        <span className="text-base font-semibold tracking-[-0.01em]">Rubriqly</span>
      </Link>
      <main className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        {children}
      </main>
    </div>
  )
}

/** Under the button while a request takes a while: the free server may be waking up. */
function WakingNote({ pending }: { pending: boolean }) {
  const slow = useSlow(pending, 3000)
  if (!slow) return null
  return (
    <p role="status" className="m-0 text-center text-[13px] text-ink-2">
      Waking up Rubriqly’s server. This can take a minute or two.
    </p>
  )
}

function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="m-0 rounded-xl bg-warn-bg px-3.5 py-2 text-[13px] text-warn">
      {message}
    </p>
  )
}

export function SignInPage() {
  const { next, finish } = useFinish()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const submit = useMutation({ mutationFn: () => signIn(email, password), onSuccess: finish })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit.mutate()
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className={label}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className={label}>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
        </label>
        <FormError message={submit.error?.message} />
        <button
          type="submit"
          disabled={submit.isPending}
          className={cn(buttonStyles.primary, 'h-11')}
        >
          {submit.isPending ? 'Signing in…' : 'Sign in'}
        </button>
        <WakingNote pending={submit.isPending} />
      </form>
      <div className="flex flex-col gap-2 text-[13px] text-ink-2">
        <p className="m-0">
          New to Rubriqly?{' '}
          <Link to={`/signup?next=${encodeURIComponent(next)}`} className={link}>
            Create an account
          </Link>
        </p>
        <p className="m-0">
          Forgot your password?{' '}
          <Link to="/contact" className={link}>
            Contact us
          </Link>{' '}
          and we’ll reset it.
        </p>
      </div>
    </AuthLayout>
  )
}

export function SignUpPage() {
  const { next, finish } = useFinish()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmsAge, setConfirmsAge] = useState(false)
  const [acceptsTerms, setAcceptsTerms] = useState(false)
  const submit = useMutation({
    mutationFn: () => signUp({ displayName, email, password, confirmsAge, acceptsTerms }),
    onSuccess: finish,
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit.mutate()
  }

  return (
    <AuthLayout title="Create your account">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className={label}>
          Name
          <input
            type="text"
            required
            maxLength={60}
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={field}
          />
        </label>
        <label className={label}>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </label>
        <label className={label}>
          Password
          <input
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            aria-describedby="password-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <span id="password-hint" className="text-xs font-normal text-ink-2">
            At least 12 characters. A few random words together work well.
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-[13px] leading-normal">
          <input
            type="checkbox"
            required
            checked={confirmsAge}
            onChange={(e) => setConfirmsAge(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>I’m {MIN_AGE} or older.</span>
        </label>
        <label className="flex items-start gap-2.5 text-[13px] leading-normal">
          <input
            type="checkbox"
            required
            checked={acceptsTerms}
            onChange={(e) => setAcceptsTerms(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" target="_blank" className={link}>
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" className={link}>
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <FormError message={submit.error?.message} />
        <button
          type="submit"
          disabled={submit.isPending}
          className={cn(buttonStyles.primary, 'h-11')}
        >
          {submit.isPending ? 'Creating your account…' : 'Create account'}
        </button>
        <WakingNote pending={submit.isPending} />
      </form>
      <p className="m-0 text-[13px] text-ink-2">
        Already have an account?{' '}
        <Link to={`/signin?next=${encodeURIComponent(next)}`} className={link}>
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
