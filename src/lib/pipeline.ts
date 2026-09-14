import { removeBackground as removeBackgroundClient } from './removeBackground'
import { removeBackgroundServer, checkServerHealth } from './api'
import { makeCutout, type CutoutAsset } from './makeCutout'
import { batchProgress, mapImglyProgress, snapshot, type ProgressSnapshot } from './progress'
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH } from '../types/domain'

export { MAX_FILES_PER_BATCH, MAX_FILE_BYTES }
/** Parallel registrations against the warm server. */
const CONCURRENCY = 3

export type ProcessResult = {
  ok: { asset: CutoutAsset; name: string }[]
  failed: { name: string; message: string }[]
}

export type ProgressHandler = (p: ProgressSnapshot) => void

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function shortName(name: string) {
  if (name.length <= 28) return name
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  return `${name.slice(0, 18)}…${ext}`
}

export function filterValidImages(files: File[]): {
  accepted: File[]
  rejected: { name: string; reason: string }[]
} {
  const accepted: File[] = []
  const rejected: { name: string; reason: string }[] = []

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      rejected.push({ name: file.name, reason: '이미지 파일이 아닙니다' })
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ name: file.name, reason: '15MB를 초과합니다' })
      continue
    }
    accepted.push(file)
  }

  if (accepted.length > MAX_FILES_PER_BATCH) {
    const overflow = accepted.splice(MAX_FILES_PER_BATCH)
    for (const f of overflow) {
      rejected.push({ name: f.name, reason: `한 번에 ${MAX_FILES_PER_BATCH}장까지` })
    }
  }

  return { accepted, rejected }
}

async function removeWithBestEngine(
  file: File,
  preferServer: boolean,
  onProgress: (phase: 'model' | 'remove', within: number, detail: string) => void,
): Promise<Blob> {
  if (preferServer) {
    try {
      return await removeBackgroundServer(file, (ratio, detail) => {
        onProgress(ratio < 0.25 ? 'model' : 'remove', 0.1 + ratio * 0.7, detail)
      })
    } catch {
      onProgress('model', 0.15, '서버 불가 · 브라우저로 전환')
    }
  }

  return removeBackgroundClient(file, (key, current, total) => {
    const mapped = mapImglyProgress(key, current, total)
    onProgress(mapped.phase === 'model' ? 'model' : 'remove', mapped.withinRemove, mapped.detail)
  })
}

async function processOne(
  file: File,
  index: number,
  total: number,
  preferServer: boolean,
  onProgress: ProgressHandler,
  onItem?: (asset: CutoutAsset, name: string) => void | Promise<void>,
): Promise<{ asset: CutoutAsset; name: string } | { error: string }> {
  const name = shortName(file.name)
  try {
    onProgress(
      snapshot({
        overall: batchProgress(index, total, 0.02),
        phase: 'queue',
        fileName: name,
        fileIndex: index + 1,
        fileTotal: total,
        detail: preferServer ? '서버 등록 시작' : '브라우저 처리 시작',
      }),
    )

    const blob = await removeWithBestEngine(file, preferServer, (phase, within, detail) => {
      onProgress(
        snapshot({
          overall: batchProgress(index, total, within),
          phase,
          fileName: name,
          fileIndex: index + 1,
          fileTotal: total,
          detail,
        }),
      )
    })

    onProgress(
      snapshot({
        overall: batchProgress(index, total, 0.88),
        phase: 'crop',
        fileName: name,
        fileIndex: index + 1,
        fileTotal: total,
        detail: '실루엣 크롭 중',
      }),
    )

    const asset = await makeCutout(blob)
    const baseName = file.name.replace(/\.[^.]+$/, '') || name
    await onItem?.(asset, baseName)

    onProgress(
      snapshot({
        overall: batchProgress(index, total, 0.97),
        phase: 'drop',
        fileName: name,
        fileIndex: index + 1,
        fileTotal: total,
        detail: '수집함에 담는 중',
      }),
    )

    await sleep(120)
    return { asset, name: baseName }
  } catch (err) {
    const message = err instanceof Error ? err.message : '처리 실패'
    return { error: message }
  }
}

/** Run up to `limit` promises at a time. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

export async function processFiles(
  files: File[],
  onProgress: ProgressHandler,
  onItem?: (asset: CutoutAsset, name: string) => void | Promise<void>,
): Promise<ProcessResult> {
  const total = files.length
  const health = await checkServerHealth()
  const preferServer = health.ok && health.ready

  if (!preferServer) {
    onProgress(
      snapshot({
        overall: 1,
        phase: 'model',
        fileName: '',
        fileIndex: 0,
        fileTotal: total,
        detail: '서버 없음 · 브라우저 엔진 사용',
      }),
    )
  }

  const results = await mapPool(files, preferServer ? CONCURRENCY : 1, (file, index) =>
    processOne(file, index, total, preferServer, onProgress, onItem),
  )

  const ok: { asset: CutoutAsset; name: string }[] = []
  const failed: { name: string; message: string }[] = []

  results.forEach((r, i) => {
    if ('error' in r) failed.push({ name: files[i].name, message: r.error })
    else ok.push(r)
  })

  if (ok.length > 0 || failed.length === 0) {
    onProgress(
      snapshot({
        overall: 100,
        phase: 'drop',
        fileName: '',
        fileIndex: total,
        fileTotal: total,
        detail: '완료',
      }),
    )
  }

  return { ok, failed }
}

/** Prefer server health; fall back to browser model warm-up. */
export async function warmupModel(onProgress?: ProgressHandler): Promise<'server' | 'browser'> {
  onProgress?.(
    snapshot({
      overall: 10,
      phase: 'warmup',
      fileName: '',
      fileIndex: 0,
      fileTotal: 0,
      detail: '서버 연결 확인',
    }),
  )

  for (let attempt = 0; attempt < 20; attempt++) {
    const health = await checkServerHealth()
    if (health.ok && health.ready) {
      onProgress?.(
        snapshot({
          overall: 100,
          phase: 'warmup',
          fileName: '',
          fileIndex: 0,
          fileTotal: 0,
          detail: '서버 엔진 준비 완료',
        }),
      )
      return 'server'
    }
    onProgress?.(
      snapshot({
        overall: Math.min(90, 15 + attempt * 4),
        phase: 'warmup',
        fileName: '',
        fileIndex: 0,
        fileTotal: 0,
        detail: health.ok ? '서버 모델 로딩 중…' : '서버 대기 중…',
      }),
    )
    await sleep(500)
  }

  // Browser fallback warm-up
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return 'browser'
  ctx.fillStyle = '#4a9088'
  ctx.fillRect(16, 12, 32, 40)

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('warmup blob failed'))
        return
      }
      try {
        await removeBackgroundClient(blob, (key, current, total) => {
          const mapped = mapImglyProgress(key, current, total)
          onProgress?.(
            snapshot({
              overall: Math.round(mapped.withinRemove * 100),
              phase: 'warmup',
              fileName: '',
              fileIndex: 0,
              fileTotal: 0,
              detail: mapped.detail || '브라우저 엔진 준비 중',
            }),
          )
        })
        resolve()
      } catch (e) {
        reject(e)
      }
    }, 'image/png')
  })

  return 'browser'
}
