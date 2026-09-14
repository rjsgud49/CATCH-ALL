import { zipSync, strToU8 } from 'fflate'

function safeFileName(name: string, index: number): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w가-힣\-]+/g, '_').slice(0, 48)
  return `${String(index + 1).padStart(2, '0')}-${base || 'cutout'}.png`
}

export async function downloadCutoutsZip(
  items: { name: string; blob: Blob }[],
  zipName = 'catch-all-collection.zip',
): Promise<void> {
  if (!items.length) return

  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()

  for (let i = 0; i < items.length; i++) {
    let filename = safeFileName(items[i].name, i)
    if (used.has(filename)) {
      filename = safeFileName(`${items[i].name}-${i}`, i)
    }
    used.add(filename)
    const buf = new Uint8Array(await items[i].blob.arrayBuffer())
    files[filename] = buf
  }

  files['README.txt'] = strToU8(
    `CATCH-ALL export\n${items.length} cutouts\n${new Date().toISOString()}\n`,
  )

  const zipped = zipSync(files, { level: 6 })
  const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName
  a.click()
  URL.revokeObjectURL(url)
}
