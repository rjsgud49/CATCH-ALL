import { useEffect, useState } from 'react'
import { listCollections, moveCutout, type CollectionRecord } from '../lib/store'

type Props = {
  src: string
  name?: string
  cutoutId?: string
  collectionId?: string
  collections?: CollectionRecord[]
  onClose: () => void
  onCollectionChange?: () => void
}

export function CutoutViewer({
  src,
  name,
  cutoutId,
  collectionId,
  collections: collectionsProp,
  onClose,
  onCollectionChange,
}: Props) {
  const [saving, setSaving] = useState(false)
  const [collections, setCollections] = useState<CollectionRecord[]>(collectionsProp ?? [])
  const [currentCol, setCurrentCol] = useState(collectionId ?? '')

  useEffect(() => {
    setCurrentCol(collectionId ?? '')
  }, [collectionId])

  useEffect(() => {
    if (collectionsProp) {
      setCollections(collectionsProp)
      return
    }
    let cancelled = false
    void listCollections().then((cols) => {
      if (!cancelled) setCollections(cols)
    })
    return () => {
      cancelled = true
    }
  }, [collectionsProp])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const download = async () => {
    setSaving(true)
    try {
      const a = document.createElement('a')
      a.href = src
      a.download = `${(name || 'cutout').replace(/\.[^.]+$/, '')}-nukki.png`
      a.click()
    } finally {
      setSaving(false)
    }
  }

  const share = async () => {
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const file = new File([blob], `${name || 'cutout'}.png`, { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'CATCH-ALL 누끼' })
      } else {
        await download()
      }
    } catch {
      /* user cancelled */
    }
  }

  const onMove = async (nextId: string) => {
    if (!cutoutId || !nextId || nextId === currentCol) return
    await moveCutout(cutoutId, nextId)
    setCurrentCol(nextId)
    onCollectionChange?.()
  }

  return (
    <div
      className="viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="누끼 미리보기"
      onClick={onClose}
    >
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="viewer-close" onClick={onClose} aria-label="닫기">
          닫기
        </button>
        <div className="viewer-stage">
          <img src={src} alt={name || '누끼 결과'} className="viewer-image" draggable={false} />
        </div>
        <p className="viewer-caption">{name || '배경을 딴 피사체'}</p>
        {cutoutId && collections.length > 0 && (
          <label className="viewer-collection">
            <span>컬렉션</span>
            <select value={currentCol} onChange={(e) => void onMove(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="viewer-actions">
          <button type="button" className="ghost-btn" onClick={download} disabled={saving}>
            PNG 저장
          </button>
          <button type="button" className="cta viewer-cta" onClick={share}>
            공유
          </button>
        </div>
      </div>
    </div>
  )
}
