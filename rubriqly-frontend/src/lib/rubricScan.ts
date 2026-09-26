import { assignIds, type BuilderValues } from './builderForm'
import type { ScannedRubric } from './types'

// Rubric photos: prepared in the browser (shrunk when big), then sent to the backend, which reads
// them and forgets them. The result opens in the builder, where the student checks it.

export const MAX_PHOTOS = 3
/** Photos this size or smaller in a format the server accepts are sent unchanged (crisp screenshots). */
const SEND_AS_IS_BYTES = 1_500_000
/** The server's limit per photo, after shrinking. */
const MAX_SEND_BYTES = 2_500_000
/** Refuse anything absurd before trying to open it. */
const MAX_PICKED_BYTES = 30_000_000
const LONGEST_SIDE = 2000
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

export class PhotoError extends Error {}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** A photo as base64, ready for `scanRubric`: small JPG/PNG/WebP as-is, anything else re-encoded. */
export async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoError(`${file.name} isn’t a photo. Choose a JPG, PNG or WebP image.`)
  }
  if (file.size > MAX_PICKED_BYTES) throw new PhotoError(`${file.name} is too big to use.`)
  if (ACCEPTED.has(file.type) && file.size <= SEND_AS_IS_BYTES) {
    return toBase64(await file.arrayBuffer())
  }

  // Bigger photos (and formats like HEIC, where the browser can open them) become a JPEG whose
  // longest side is at most 2000px: plenty to read a table, and quick to upload.
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new PhotoError(
      `This browser can’t open ${file.name}. Try a JPG or PNG, or take a screenshot of it.`,
    )
  }
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new PhotoError(`We couldn’t prepare ${file.name}. Try another photo.`)
  if (blob.size > MAX_SEND_BYTES) throw new PhotoError(`${file.name} is too big to send.`)
  return toBase64(await blob.arrayBuffer())
}

/** The scanner's own writing, remembered per criterion so the builder can mark it until edited. */
export interface Suggestions {
  [itemId: string]: { question: string; tips: string[] }
}

export function scannedToBuilderValues(scan: ScannedRubric): {
  values: BuilderValues
  suggestions: Suggestions
} {
  const n = scan.levels.length
  const items = assignIds([
    ...scan.criteria.map((c) => ({
      id: '',
      name: c.name,
      kind: 'score' as const,
      question: c.suggested_question,
      descriptors: c.descriptors,
      tips: c.suggested_tips,
    })),
    ...scan.checklist.map((item) => ({
      id: '',
      name: item.name,
      kind: 'yesno' as const,
      question: item.suggested_question,
      descriptors: Array<string>(n).fill(''),
      tips: Array<string>(n).fill(''),
    })),
  ])
  const suggestions: Suggestions = {}
  for (const item of items) {
    suggestions[item.id] = {
      question: item.question,
      tips: item.kind === 'score' ? item.tips : [],
    }
  }
  const range = scan.word_count
  const rules: BuilderValues['rules'] = {}
  if (range && (range.min || range.max)) {
    rules.word_count = {
      ...(range.min ? { min: range.min } : {}),
      ...(range.max ? { max: range.max } : {}),
    }
  }
  return {
    values: { id: '', version: 1, title: scan.title, levels: scan.levels, items, rules },
    suggestions,
  }
}

/** True while a field still holds the scanner's suggestion (edits, even small ones, clear it). */
export function isSuggested(value: string, suggestion: string | undefined): boolean {
  return Boolean(suggestion) && value === suggestion
}
