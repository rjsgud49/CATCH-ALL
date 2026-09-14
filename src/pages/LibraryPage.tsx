import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CutoutViewer } from '../components/CutoutViewer'
import { downloadCutoutsZip } from '../lib/exportZip'
import {
  createCollection,
  deleteCutouts,
  getCutoutBlobs,
  listCollections,
  listCutouts,
  moveCutout,
  revokeStoredUrls,
  type CollectionRecord,
  type StoredCutout,
} from '../lib/store'

type Props = {
  push: (kind: 'ok' | 'warn' | 'error', message: string) => void
  onLibraryChange: () => void
  onDropToCatch: (ids: string[]) => void
  refreshToken: number
}

export function LibraryPage({ push, onLibraryChange, onDropToCatch, refreshToken }: Props) {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<CollectionRecord[]>([])
  const [items, setItems] = useState<StoredCutout[]>([])
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<StoredCutout | null>(null)
  const [exporting, setExporting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [cols, cutouts] = await Promise.all([
        listCollections(),
        listCutouts(filter === 'all' ? 'all' : filter),
      ])
      setItems((prev) => {
        prev.forEach(revokeStoredUrls)
        return cutouts
      })
      setCollections(cols)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void reload()
  }, [reload, refreshToken])

  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => {
    return () => {
      itemsRef.current.forEach(revokeStoredUrls)
    }
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, query])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelected(new Set(visible.map((v) => v.id)))
  }

  const clearSelection = () => setSelected(new Set())

  const handleNewCollection = async () => {
    const name = window.prompt('새 컬렉션 이름')
    if (!name?.trim()) return
    await createCollection(name)
    onLibraryChange()
    await reload()
    push('ok', '컬렉션을 만들었어요')
  }

  const handleDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`선택한 ${selected.size}장을 라이브러리에서 삭제할까요?`)) return
    const ids = [...selected]
    await deleteCutouts(ids)
    setItems((prev) => {
      const remove = new Set(ids)
      const kept: StoredCutout[] = []
      for (const item of prev) {
        if (remove.has(item.id)) revokeStoredUrls(item)
        else kept.push(item)
      }
      return kept
    })
    clearSelection()
    onLibraryChange()
    push('ok', '삭제했어요')
  }

  const handleExport = async () => {
    if (!selected.size) return
    setExporting(true)
    try {
      const blobs = await getCutoutBlobs([...selected])
      await downloadCutoutsZip(
        blobs.map((b) => ({ name: b.name, blob: b.blob })),
        'catch-all-library.zip',
      )
      push('ok', `ZIP으로 ${blobs.length}장을 내보냈어요`)
    } catch (err) {
      push('error', err instanceof Error ? err.message : '내보내기에 실패했습니다')
    } finally {
      setExporting(false)
    }
  }

  const handleDropToCatch = () => {
    if (!selected.size) return
    onDropToCatch([...selected])
    clearSelection()
    navigate('/')
  }

  const handleMove = async (collectionId: string) => {
    if (!selected.size) return
    for (const id of selected) {
      await moveCutout(id, collectionId)
    }
    clearSelection()
    onLibraryChange()
    await reload()
    push('ok', '컬렉션으로 옮겼어요')
  }

  return (
    <div className="page library-page">
      <main className="library">
        <header className="library-head">
          <div>
            <h1 className="library-title">Library</h1>
            <p className="library-sub">모은 누끼를 꺼내 쓰고, 묶어 내보냅니다.</p>
          </div>
          <div className="library-head-actions">
            <button type="button" className="ghost-btn" onClick={() => void handleNewCollection()}>
              새 컬렉션
            </button>
            <button
              type="button"
              className="cta"
              disabled={!selected.size || exporting}
              onClick={() => void handleExport()}
            >
              {exporting ? '내보내는 중…' : `ZIP 내보내기${selected.size ? ` · ${selected.size}` : ''}`}
            </button>
          </div>
        </header>

        <div className="library-toolbar">
          <div className="library-chips" role="tablist" aria-label="컬렉션">
            <button
              type="button"
              className={filter === 'all' ? 'lib-chip lib-chip--on' : 'lib-chip'}
              onClick={() => setFilter('all')}
            >
              전체
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={filter === c.id ? 'lib-chip lib-chip--on' : 'lib-chip'}
                onClick={() => setFilter(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <input
            className="library-search"
            type="search"
            placeholder="이름 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="누끼 검색"
          />
        </div>

        {selected.size > 0 && (
          <div className="library-selection-bar">
            <span>{selected.size}장 선택</span>
            <div className="library-selection-actions">
              <button type="button" className="ghost-btn" onClick={selectAllVisible}>
                보이는 것 모두
              </button>
              <button type="button" className="ghost-btn" onClick={clearSelection}>
                선택 해제
              </button>
              <label className="library-move">
                <span className="sr-only">컬렉션으로 이동</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    e.target.value = ''
                    if (v) void handleMove(v)
                  }}
                >
                  <option value="" disabled>
                    컬렉션으로 이동
                  </option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="ghost-btn" onClick={handleDropToCatch}>
                어항에 다시 넣기
              </button>
              <button type="button" className="ghost-btn ghost-btn--danger" onClick={() => void handleDelete()}>
                삭제
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="library-empty">불러오는 중…</p>
        ) : visible.length === 0 ? (
          <div className="library-empty">
            <p>아직 모은 누끼가 없어요.</p>
            <button type="button" className="cta" onClick={() => navigate('/')}>
              Catch에서 수집하기
            </button>
          </div>
        ) : (
          <ul className="library-grid">
            {visible.map((item) => {
              const on = selected.has(item.id)
              return (
                <li key={item.id}>
                  <div className={on ? 'lib-tile lib-tile--on' : 'lib-tile'}>
                    <button
                      type="button"
                      className="lib-tile-check"
                      aria-pressed={on}
                      aria-label={on ? '선택 해제' : '선택'}
                      onClick={() => toggle(item.id)}
                    >
                      {on ? '✓' : ''}
                    </button>
                    <button
                      type="button"
                      className="lib-tile-body"
                      onClick={() => setPreview(item)}
                      title={item.name}
                    >
                      <img src={item.previewUrl} alt={item.name} draggable={false} />
                      <span className="lib-tile-name">{item.name}</span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {preview && (
        <CutoutViewer
          src={preview.previewUrl}
          name={preview.name}
          cutoutId={preview.id}
          collectionId={preview.collectionId}
          collections={collections}
          onClose={() => setPreview(null)}
          onCollectionChange={() => {
            onLibraryChange()
            void reload()
          }}
        />
      )}
    </div>
  )
}
