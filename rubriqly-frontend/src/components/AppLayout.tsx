import { Menu } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { readSidebarCollapsed, useAccount, useSlow, writeSidebarCollapsed } from '../lib/hooks'
import { buttonStyles, cn } from '../lib/ui'
import { Logo } from './Logo'
import { Sidebar } from './Sidebar'

/**
 * Every app page needs an account. While the server is asked who's signed in, a blank page is
 * shown (with a note if the free server is slowly waking up); signed-out visitors go to /signin
 * and come back here afterwards.
 */
export function AppLayout() {
  const account = useAccount()
  const location = useLocation()

  if (account.isPending) return <Waking />
  if (account.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <p role="alert" className="m-0 max-w-sm text-sm text-ink">
          {account.error.message}
        </p>
        <button type="button" onClick={() => account.refetch()} className={buttonStyles.secondary}>
          Try again
        </button>
      </div>
    )
  }
  if (!account.data) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/signin?next=${next}`} replace />
  }
  return <AppShell />
}

/** The free server sleeps when unused and can take a minute or two to wake: say so after a moment. */
function Waking() {
  const slow = useSlow(true, 3000)
  return (
    <div data-page-fallback="" className="flex min-h-screen items-center justify-center bg-bg p-6">
      {slow && (
        <p role="status" className="m-0 max-w-sm text-center text-sm text-ink-2">
          Waking up Rubriqly’s server. This can take a minute or two.
        </p>
      )}
    </div>
  )
}

/**
 * The app shell: a sidebar on large screens (collapsible to an icon rail), and a top bar with a
 * menu button that opens the sidebar as a drawer on small screens.
 */
function AppShell() {
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      writeSidebarCollapsed(!value)
      return !value
    })
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-r border-border transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-[260px]',
        )}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      <div className="flex min-w-0 grow flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-chrome px-3 lg:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink hover:bg-muted"
          >
            <Menu size={20} />
          </button>
          <Logo />
        </div>
        <main className="flex min-w-0 grow flex-col">
          <Outlet />
        </main>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}

function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label="Menu"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself, and following any link
        // inside the drawer should close it too.
        const target = event.target as HTMLElement
        if (target === event.currentTarget || target.closest('a')) onClose()
      }}
      className="m-0 h-full max-h-none w-[280px] max-w-[85vw] border-0 border-r border-border bg-chrome p-0 text-ink backdrop:bg-black/40 lg:hidden"
    >
      {open && <Sidebar onClose={onClose} />}
    </dialog>
  )
}
