import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CutoutViewer } from '../components/CutoutViewer'
import type { ToastPush } from '../components/ToastStack'
import { downloadCutoutsZip } from '../lib/exportZip'
import {
  createCollection,
  deleteCutouts,
  getCutoutBlobs,
  getCutoutsByIds,
  listCollections,
  listCutouts,
  loadSessionIds,
  moveCutout,
  revokeStoredUrls,
  type CollectionRecord,
  type StoredCutout,
} from '../lib/store'

const FILTER_ALL = 'all'
const FILTER_TANK = 'in-tank'

type Props = {
  push: ToastPush
  onLibraryChange: () => void
  onDropToCatch: (ids: string[]) => void
  refreshToken: number
}

export function LibraryPage({ push, onLibraryChange, onDropToCatch, refreshToken }: Props) {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<CollectionRecord[]>([])
  const [items, setItems] = useState<StoredCutout[]>([])
  const [tankIds, setTankIds] = useState<Set<string>>(() => new Set(loadSessionIds()))
  const [filter, setFilter] = useState<string>(FILTER_ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<StoredCutout | null>(null)
  const [exporting, setExporting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const session = new Set(loadSessionIds())
      setTankIds(session)

      const cols = await listCollections()
      setCollections(cols)

      let cutouts: StoredCutout[]
      if (filter === FILTER_TANK) {
        cutouts = await getCutoutsByIds([...session])
      } else {
        cutouts = await listCutouts(filter === FILTER_ALL ? 'all' : filter)
      }

      setItems((prev) => {
        prev.forEach(revokeStoredUrls)
        return cutouts
      })
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

  const tankCount = tankIds.size
  const viewingTank = filter === FILTER_TANK

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

  const selectAllInTank = () => {
    setSelected(new Set([...tankIds]))
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
    const count = selected.size
    for (const id of selected) {
      await moveCutout(id, collectionId)
    }
    clearSelection()
    onLibraryChange()
    await reload()
    const colName = collections.find((c) => c.id === collectionId)?.name || '컬렉션'
    push('ok', `${count}장을「${colName}」으로 분류했어요`)
  }

  const handleClassifyTank = async () => {
    if (!tankCount) {
      push('warn', '어항에 있는 누끼가 없어요')
      return
    }
    setFilter(FILTER_TANK)
    setSelected(new Set(loadSessionIds()))
    push('ok', '어항 조각을 선택했어요 · 컬렉션으로 분류하세요')
  }

  return (
    <div className="page library-page">
      <main className="library">
        <header className="library-head">
          <div>
            <h1 className="library-title">Library</h1>
            <p className="library-sub">모은 누끼를 꺼내 쓰고, 어항 속 조각도 여기서 분류합니다.</p>
          </div>
          <div className="library-head-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={!tankCount}
              onClick={() => void handleClassifyTank()}
              title="지금 어항에 있는 누끼만 골라 분류"
            >
              어항 분류{tankCount ? ` · ${tankCount}` : ''}
            </button>
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
              className={filter === FILTER_ALL ? 'lib-chip lib-chip--on' : 'lib-chip'}
              onClick={() => setFilter(FILTER_ALL)}
            >
              전체
            </button>
            <button
              type="button"
              className={filter === FILTER_TANK ? 'lib-chip lib-chip--on lib-chip--tank' : 'lib-chip lib-chip--tank'}
              onClick={() => setFilter(FILTER_TANK)}
              disabled={!tankCount && !viewingTank}
            >
              어항{tankCount ? ` · ${tankCount}` : ''}
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

        {viewingTank && (
          <div className="library-tank-hint">
            <p>지금 Catch 어항에 들어 있는 누끼입니다. 골라서 컬렉션으로 분류하세요.</p>
            <button type="button" className="ghost-btn" onClick={selectAllInTank} disabled={!tankCount}>
              어항 전체 선택
            </button>
          </div>
        )}

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
                <span className="sr-only">컬렉션으로 분류</span>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value
                    e.target.value = ''
                    if (v) void handleMove(v)
                  }}
                >
                  <option value="" disabled>
                    컬렉션으로 분류
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
            <p>
              {viewingTank
                ? '어항이 비어 있어요. Catch에서 이미지를 넣어 보세요.'
                : '아직 모은 누끼가 없어요.'}
            </p>
            <button type="button" className="cta" onClick={() => navigate('/')}>
              Catch로 가기
            </button>
          </div>
        ) : (
          <ul className="library-grid">
            {visible.map((item) => {
              const on = selected.has(item.id)
              const inTank = tankIds.has(item.id)
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
                    {inTank && <span className="lib-tile-badge">어항</span>}
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
