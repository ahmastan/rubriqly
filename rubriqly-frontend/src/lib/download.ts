/**
 * Save a file to the student's device. The temporary address is released a minute later:
 * releasing it straight after the click can cancel the download in some browsers.
 */
export function downloadFile(contents: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
