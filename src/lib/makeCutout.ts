import type { Point } from '../types/domain'

const ALPHA_THRESHOLD = 24
const MAX_TEXTURE = 320
const PAD = 4
const TARGET_VERTICES = 28

export type { Point }

export type CutoutAsset = {
  /** Transparent PNG cropped to subject (nukki). */
  textureUrl: string
  /** Same image for lightbox. */
  previewUrl: string
  width: number
  height: number
  /** Contour in texture pixel space (clockwise). */
  vertices: Point[]
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load processed image'))
    }
    img.src = url
  })
}

function findOpaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return null
  return { minX, minY, maxX, maxY }
}

function isOpaque(data: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  return data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD
}

/** Moore neighborhood boundary trace (outer contour). */
function traceContour(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Point[] {
  let startX = -1
  let startY = -1
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isOpaque(data, width, height, x, y)) {
        startX = x
        startY = y
        break outer
      }
    }
  }
  if (startX < 0) return []

  // N, NE, E, SE, S, SW, W, NW
  const dx = [0, 1, 1, 1, 0, -1, -1, -1]
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1]

  const points: Point[] = []
  let x = startX
  let y = startY
  let dir = 0 // start looking from north after coming from west
  const maxSteps = width * height * 2

  for (let step = 0; step < maxSteps; step++) {
    points.push({ x, y })
    let found = false
    // Start search from dir-2 (Moore)
    for (let i = 0; i < 8; i++) {
      const nd = (dir + 6 + i) % 8
      const nx = x + dx[nd]
      const ny = y + dy[nd]
      if (isOpaque(data, width, height, nx, ny)) {
        x = nx
        y = ny
        dir = nd
        found = true
        break
      }
    }
    if (!found) break
    if (x === startX && y === startY && points.length > 8) break
  }

  return points
}

function perpendicularDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice()
  let maxDist = 0
  let maxIdx = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const d = perpendicularDist(points[i], points[0], points[end])
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, maxIdx + 1), epsilon)
    const right = rdp(points.slice(maxIdx), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [points[0], points[end]]
}

function simplifyContour(points: Point[], targetCount: number): Point[] {
  if (points.length <= targetCount) return points
  let lo = 0.5
  let hi = 40
  let best = points
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    const simplified = rdp(points, mid)
    if (simplified.length > targetCount) lo = mid
    else {
      best = simplified
      hi = mid
    }
  }
  if (best.length < 3) {
    // Fallback: uniform sample
    const out: Point[] = []
    const step = points.length / targetCount
    for (let i = 0; i < targetCount; i++) out.push(points[Math.floor(i * step) % points.length])
    return out
  }
  return best
}

function ensureWinding(points: Point[]): Point[] {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a.x * b.y - b.x * a.y
  }
  // Matter prefers clockwise in screen coords (y-down) which is negative area
  if (area > 0) return points.slice().reverse()
  return points
}

/** Crop nukki to opaque bounds and build physics contour. */
export async function makeCutout(transparentBlob: Blob): Promise<CutoutAsset> {
  const img = await loadImageFromBlob(transparentBlob)

  const full = document.createElement('canvas')
  full.width = img.naturalWidth
  full.height = img.naturalHeight
  const fctx = full.getContext('2d', { willReadFrequently: true })
  if (!fctx) throw new Error('Canvas not available')
  fctx.drawImage(img, 0, 0)
  const fullData = fctx.getImageData(0, 0, full.width, full.height)
  const bounds = findOpaqueBounds(fullData.data, full.width, full.height)
  if (!bounds) throw new Error('피사체를 찾지 못했습니다')

  const cropW = bounds.maxX - bounds.minX + 1 + PAD * 2
  const cropH = bounds.maxY - bounds.minY + 1 + PAD * 2
  const sx = bounds.minX - PAD
  const sy = bounds.minY - PAD

  const scale = Math.min(1, MAX_TEXTURE / Math.max(cropW, cropH))
  const width = Math.max(1, Math.round(cropW * scale))
  const height = Math.max(1, Math.round(cropH * scale))

  const crop = document.createElement('canvas')
  crop.width = width
  crop.height = height
  const cctx = crop.getContext('2d', { willReadFrequently: true })
  if (!cctx) throw new Error('Canvas not available')
  cctx.drawImage(full, sx, sy, cropW, cropH, 0, 0, width, height)

  const { data } = cctx.getImageData(0, 0, width, height)
  let contour = traceContour(data, width, height)
  if (contour.length < 8) {
    // Rectangle fallback
    contour = [
      { x: 2, y: 2 },
      { x: width - 2, y: 2 },
      { x: width - 2, y: height - 2 },
      { x: 2, y: height - 2 },
    ]
  } else {
    // Skip dense points then RDP
    const stride = Math.max(1, Math.floor(contour.length / 400))
    const sampled = contour.filter((_, i) => i % stride === 0)
    contour = ensureWinding(simplifyContour(sampled, TARGET_VERTICES))
  }

  const textureUrl = crop.toDataURL('image/png')
  return {
    textureUrl,
    previewUrl: textureUrl,
    width,
    height,
    vertices: contour,
  }
}
