import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ImagePlus, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { getScanQuota, SCAN_PRIVACY_NOTICE, SCAN_QUOTA_KEY, scanRubric } from '../lib/api'
import { ACCOUNT_KEY } from '../lib/auth'
import { useSlow } from '../lib/hooks'
import { ApiError } from '../lib/http'
import { MAX_PHOTOS, preparePhoto } from '../lib/rubricScan'
import type { ScanQuota } from '../lib/types'
import { buttonStyles, cn, pageBar } from '../lib/ui'

interface Photo {
  key: string
  file: File
  /** For the thumbnail; released when the photo is removed or the page closes. */
  url: string
}

export function RubricScanPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [notice, setNotice] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const quota = useQuery({ queryKey: SCAN_QUOTA_KEY, queryFn: getScanQuota })

  // Release thumbnails when leaving the page.
  const photosRef = useRef(photos)
  useEffect(() => {
    photosRef.current = photos
  }, [photos])
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), [])

  const scan = useMutation({
    mutationFn: async () => scanRubric(await Promise.all(photos.map((p) => preparePhoto(p.file)))),
    onSuccess: (result) => {
      queryClient.setQueryData(SCAN_QUOTA_KEY, result.quota)
      navigate('/rubrics/new', { state: { scan: result } })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(ACCOUNT_KEY, null)
      }
      if (error instanceof ApiError && error.code === 'weekly_scan_limit') {
        void queryClient.invalidateQueries({ queryKey: SCAN_QUOTA_KEY })
      }
    },
  })
  const slow = useSlow(scan.isPending, 8000)

  const addFiles = (files: FileList | File[] | null) => {
    setNotice(undefined)
    scan.reset()
    const all = Array.from(files ?? [])
    const picked = all.filter((file) => file.type.startsWith('image/'))
    const room = MAX_PHOTOS - photos.length
    const added = picked.slice(0, Math.max(0, room)).map((file) => ({
      key: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
    }))
    if (picked.length < all.length) {
      setNotice('Only photos can be scanned (JPG, PNG or WebP), so some files weren’t added.')
    } else if (picked.length > added.length) {
      setNotice(`A scan can have up to ${MAX_PHOTOS} photos, so some weren’t added.`)
    }
    setPhotos((current) => [...current, ...added])
  }

  const remove = (key: string) => {
    scan.reset()
    setPhotos((current) => {
      const photo = current.find((p) => p.key === key)
      if (photo) URL.revokeObjectURL(photo.url)
      return current.filter((p) => p.key !== key)
    })
  }

  const move = (from: number, to: number) => {
    setPhotos((current) => {
      const next = [...current]
      next.splice(to, 0, next.splice(from, 1)[0])
      return next
    })
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const unavailable = quota.data?.available === false
  const outOfScans = quota.data !== undefined && quota.data.used >= quota.data.limit
  const canScan = photos.length > 0 && !outOfScans && !unavailable && !scan.isPending

  return (
    <div className="flex grow flex-col">
      <div className={pageBar}>
        <Link to="/rubrics" className="text-sm text-ink-2 no-underline hover:text-ink">
          Rubrics
        </Link>
        <span className="text-ink-2" aria-hidden="true">
          /
        </span>
        <h1 className="m-0 grow text-base font-semibold">Scan a rubric</h1>
      </div>

      <div className="mx-auto flex w-full max-w-[680px] flex-col gap-5 px-4 py-8 sm:px-8">
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[15px] leading-normal text-ink-soft">
            Add photos or screenshots of your rubric. Rubriqly copies it into the rubric builder,
            where you check it against the original before saving.
          </p>
          <QuotaLine quota={quota.data} />
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col gap-3 rounded-2xl border border-dashed bg-surface p-4 transition-colors',
            dragging ? 'border-accent' : 'border-field-border',
          )}
        >
          {photos.length > 0 && (
            <ol
              aria-label="Photos, in page order"
              className="m-0 flex list-none flex-col gap-2 p-0"
            >
              {photos.map((photo, index) => (
                <li
                  key={photo.key}
                  className="flex items-center gap-3 rounded-xl border border-border bg-bg p-2"
                >
                  <img
                    src={photo.url}
                    alt={`Page ${index + 1}`}
                    className="size-16 shrink-0 rounded-lg bg-muted object-cover"
                  />
                  <div className="flex min-w-0 grow flex-col">
                    <span className="text-sm font-medium">Page {index + 1}</span>
                    <span className="truncate text-xs text-ink-2">{photo.file.name}</span>
                  </div>
                  <IconButton
                    label={`Move page ${index + 1} up`}
                    disabled={index === 0 || scan.isPending}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move page ${index + 1} down`}
                    disabled={index === photos.length - 1 || scan.isPending}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown size={15} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove page ${index + 1}`}
                    disabled={scan.isPending}
                    onClick={() => remove(photo.key)}
                  >
                    <X size={15} aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ol>
          )}

          {photos.length < MAX_PHOTOS && (
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={scan.isPending}
                className={buttonStyles.secondary}
              >
                <ImagePlus size={16} aria-hidden="true" />
                {photos.length === 0 ? 'Add photos' : 'Add another page'}
              </button>
              <span className="text-[13px] text-ink-2">
                Or drop them here. Up to {MAX_PHOTOS} pages, JPG, PNG or WebP.
              </span>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            aria-label="Choose rubric photos"
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        <p className="m-0 text-[13px] leading-normal text-ink-2">
          For the best result, photograph the whole table straight on, in good light. For a rubric
          over several pages, add the pages in order.
        </p>

        {notice && (
          <p role="status" className="m-0 text-[13px] text-ink-2">
            {notice}
          </p>
        )}
        {scan.isPending && (
          <p role="status" className="m-0 flex items-center gap-2 text-[13px] text-ink-2">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            Reading your rubric. This usually takes 10 to 30 seconds.
            {slow && ' The server may be waking up; this can take a minute or two.'}
          </p>
        )}
        {scan.isError && (
          <p role="alert" className="m-0 rounded-xl bg-warn-bg px-3.5 py-2 text-[13px] text-warn">
            {scan.error.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canScan}
            onClick={() => scan.mutate()}
            className={buttonStyles.primary}
          >
            {scan.isPending
              ? 'Reading…'
              : photos.length > 1
                ? `Scan ${photos.length} pages`
                : 'Scan rubric'}
          </button>
          <Link to="/rubrics/new" className={buttonStyles.ghost}>
            Build one by hand instead
          </Link>
        </div>

        <p className="m-0 text-xs leading-normal text-ink-2">{SCAN_PRIVACY_NOTICE}</p>
      </div>
    </div>
  )
}

function QuotaLine({ quota }: { quota?: ScanQuota }) {
  if (!quota) return null
  if (!quota.available) {
    return (
      <p role="status" className="m-0 text-[13px] text-ink">
        Rubric scanning isn’t available right now. You can still build a rubric by hand.
      </p>
    )
  }
  const left = Math.max(0, quota.limit - quota.used)
  if (left > 0) {
    return (
      <p className="m-0 text-[13px] text-ink-2">
        {left} of {quota.limit} scans left this week.
      </p>
    )
  }
  const next = quota.next_free_at
    ? new Date(quota.next_free_at).toLocaleString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : undefined
  return (
    <p role="status" className="m-0 text-[13px] text-ink">
      You’ve used this week’s {quota.limit} scans.
      {next ? ` Your next scan is available ${next}.` : ''} You can still build a rubric by hand.
    </p>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-2 hover:bg-muted hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
