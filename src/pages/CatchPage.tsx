import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { JarCanvas, type JarCanvasHandle } from '../components/JarCanvas'
import { Uploader } from '../components/Uploader'
import { CutoutViewer } from '../components/CutoutViewer'
import { ProgressPanel } from '../components/ProgressPanel'
import { CollectionTray } from '../components/CollectionTray'
import { filterValidImages, processFiles, warmupModel } from '../lib/pipeline'
import type { ProgressSnapshot } from '../lib/progress'
import type { CutoutAsset } from '../lib/makeCutout'
import {
  clearSessionIds,
  getCutoutsByIds,
  loadSessionIds,
  revokeStoredUrls,
  saveCutout,
  saveSessionIds,
  type StoredCutout,
} from '../lib/store'

type Preview = { id?: string; src: string; name: string; collectionId?: string }

type Props = {
  push: (kind: 'ok' | 'warn' | 'error', message: string) => void
  onLibraryChange: () => void
  pendingDropIds?: string[]
  onPendingDropConsumed?: () => void
}

export function CatchPage({
  push,
  onLibraryChange,
  pendingDropIds,
  onPendingDropConsumed,
}: Props) {
  const jarRef = useRef<JarCanvasHandle>(null)
  const busyRef = useRef(false)
  const restoredRef = useRef(false)
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null)
  const [warming, setWarming] = useState(false)
  const [items, setItems] = useState<StoredCutout[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [pageDrag, setPageDrag] = useState(false)
  const [ready, setReady] = useState(false)

  const busy = progress !== null && !warming

  const syncSession = useCallback((next: StoredCutout[]) => {
    setItems(next)
    saveSessionIds(next.map((i) => i.id))
  }, [])

  // Warmup engine
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setWarming(true)
      try {
        const mode = await warmupModel((p) => {
          if (!cancelled) setProgress(p)
        })
        if (!cancelled) {
          push(
            'ok',
            mode === 'server'
              ? '서버 엔진 준비 완료 · 빠른 수집 가능'
              : '브라우저 엔진 준비 완료 · 이미지를 넣어 보세요',
          )
        }
      } catch {
        if (!cancelled) {
          push('warn', '엔진 사전 로딩을 건너뛰었어요. 첫 업로드 때 준비됩니다')
        }
      } finally {
        if (!cancelled) {
          setWarming(false)
          setProgress(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [push])

  // Restore session into jar once canvas is mounted
  useEffect(() => {
    if (restoredRef.current) return
    let cancelled = false
    ;(async () => {
      const ids = loadSessionIds()
      if (!ids.length) {
        restoredRef.current = true
        setReady(true)
        return
      }
      const restored = await getCutoutsByIds(ids)
      if (cancelled) {
        restored.forEach(revokeStoredUrls)
        return
      }
      syncSession(restored)
      const tryAdd = (attempt: number) => {
        if (cancelled) return
        if (jarRef.current) {
          for (const item of restored) {
            jarRef.current.addCutout(toAsset(item))
          }
          restoredRef.current = true
          setReady(true)
          return
        }
        if (attempt < 20) {
          requestAnimationFrame(() => tryAdd(attempt + 1))
        } else {
          restoredRef.current = true
          setReady(true)
        }
      }
      tryAdd(0)
    })()
    return () => {
      cancelled = true
    }
  }, [syncSession])

  // Drop from library ("통에 다시 넣기")
  useEffect(() => {
    if (!pendingDropIds?.length || !ready) return
    let cancelled = false
    ;(async () => {
      const fetched = await getCutoutsByIds(pendingDropIds)
      if (cancelled) {
        fetched.forEach(revokeStoredUrls)
        return
      }
      setItems((prev) => {
        const existing = new Set(prev.map((p) => p.id))
        const merged = [...prev]
        for (const item of fetched) {
          if (existing.has(item.id)) {
            revokeStoredUrls(item)
            continue
          }
          jarRef.current?.addCutout(toAsset(item))
          merged.push(item)
        }
        saveSessionIds(merged.map((i) => i.id))
        return merged
      })
      if (fetched.length) push('ok', `${fetched.length}장을 통에 다시 넣었어요`)
      onPendingDropConsumed?.()
    })()
    return () => {
      cancelled = true
    }
  }, [pendingDropIds, ready, push, onPendingDropConsumed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement | null)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        if (!busyRef.current) jarRef.current?.shake()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Cleanup object URLs on unmount
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => {
    return () => {
      itemsRef.current.forEach(revokeStoredUrls)
    }
  }, [])

  const ingestFiles = useCallback(
    async (raw: File[]) => {
      if (busyRef.current) {
        push('warn', '아직 처리 중이에요')
        return
      }
      const { accepted, rejected } = filterValidImages(raw)
      for (const r of rejected) push('warn', `${r.name}: ${r.reason}`)
      if (!accepted.length) return

      busyRef.current = true
      setWarming(false)
      let savedCount = 0

      try {
        const { ok, failed } = await processFiles(accepted, setProgress, async (asset, name) => {
          const stored = await saveCutout({
            name,
            textureUrl: asset.textureUrl,
            previewUrl: asset.previewUrl,
            width: asset.width,
            height: asset.height,
            vertices: asset.vertices,
          })
          jarRef.current?.addCutout(toAsset(stored))
          setItems((prev) => {
            const next = [...prev, stored]
            saveSessionIds(next.map((i) => i.id))
            return next
          })
          savedCount += 1
          onLibraryChange()
        })

        if (ok.length || savedCount) {
          push('ok', `${savedCount || ok.length}장을 수집함에 담았어요`)
        }
        for (const f of failed) push('error', `${f.name}: ${f.message}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : '처리에 실패했습니다'
        push('error', message)
      } finally {
        busyRef.current = false
        setProgress(null)
      }
    },
    [push, onLibraryChange],
  )

  const onPageDragOver = (e: DragEvent) => {
    e.preventDefault()
    if (!busyRef.current) setPageDrag(true)
  }

  const onPageDragLeave = (e: DragEvent) => {
    if (e.currentTarget === e.target) setPageDrag(false)
  }

  const onPageDrop = (e: DragEvent) => {
    e.preventDefault()
    setPageDrag(false)
    if (e.dataTransfer.files?.length) {
      void ingestFiles(Array.from(e.dataTransfer.files))
    }
  }

  const clearSession = () => {
    if (!items.length) return
    if (!window.confirm('어항만 비울까요? 라이브러리에 모은 누끼는 그대로 둡니다.')) return
    jarRef.current?.clear()
    items.forEach(revokeStoredUrls)
    syncSession([])
    clearSessionIds()
    push('ok', '어항을 비웠어요 · 라이브러리는 유지됩니다')
  }

  const openPreviewByUrl = (url: string) => {
    const found = items.find((i) => i.previewUrl === url || i.textureUrl === url)
    setPreview({
      id: found?.id,
      src: url,
      name: found?.name || '누끼',
      collectionId: found?.collectionId,
    })
  }

  return (
    <div
      className={`page ${pageDrag ? 'page--drag' : ''}`}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {pageDrag && <div className="page-drop-hint">여기에 놓으면 수집해요</div>}

      <main className={`hero hero--tank ${items.length ? 'hero--with-tray' : ''}`}>
        <aside className="hero-side">
          <ProgressPanel progress={progress} warming={warming} />

          <div className="controls">
            <Uploader disabled={busy || warming} onFiles={(files) => void ingestFiles(files)} />
            <button
              type="button"
              className="shake-btn"
              onClick={() => jarRef.current?.shake()}
              disabled={items.length === 0 || busy}
              title="단축키 S"
            >
              어항 흔들기
            </button>
          </div>

          {!progress && items.length === 0 && !warming && (
            <p className="status-line">이미지 여러 장 · 최대 12장 · 15MB 이하</p>
          )}
          {!progress && items.length > 0 && (
            <p className="status-line">조각을 클릭하면 확대 · S 키로 흔들기</p>
          )}
        </aside>

        <div className="jar-stage">
          <JarCanvas
            ref={jarRef}
            className="jar-host"
            empty={items.length === 0}
            busy={busy || warming}
            onCutoutClick={openPreviewByUrl}
          />
          <div className="jar-glow" aria-hidden />
        </div>

        <CollectionTray
          items={items}
          disabled={busy}
          onSelect={(item) =>
            setPreview({
              id: item.id,
              src: item.previewUrl,
              name: item.name,
              collectionId: item.collectionId,
            })
          }
          onClear={clearSession}
          libraryLink={
            <Link to="/library" className="collection-lib-link">
              라이브러리 보기
            </Link>
          }
        />
      </main>

      {preview && (
        <CutoutViewer
          src={preview.src}
          name={preview.name}
          cutoutId={preview.id}
          collectionId={preview.collectionId}
          onClose={() => setPreview(null)}
          onCollectionChange={() => onLibraryChange()}
        />
      )}
    </div>
  )
}

function toAsset(item: StoredCutout): CutoutAsset {
  return {
    textureUrl: item.textureUrl,
    previewUrl: item.previewUrl,
    width: item.width,
    height: item.height,
    vertices: item.vertices,
  }
}
