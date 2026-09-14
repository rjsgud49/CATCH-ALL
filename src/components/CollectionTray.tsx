import type { ReactNode } from 'react'
import type { StoredCutout } from '../lib/store'

type Props = {
  items: StoredCutout[]
  onSelect: (item: StoredCutout) => void
  onClear: () => void
  disabled?: boolean
  libraryLink?: ReactNode
}

export function CollectionTray({ items, onSelect, onClear, disabled, libraryLink }: Props) {
  if (items.length === 0) return null

  return (
    <section className="collection" aria-label="이번 캐치">
      <div className="collection-head">
        <h2 className="collection-title">이번 캐치 · {items.length}</h2>
        <div className="collection-head-actions">
          {libraryLink}
          <button type="button" className="ghost-btn" disabled={disabled} onClick={onClear}>
            어항만 비우기
          </button>
        </div>
      </div>
      <div className="collection-rail">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="collection-chip"
            onClick={() => onSelect(item)}
            title={item.name}
          >
            <img src={item.previewUrl} alt={item.name} draggable={false} />
          </button>
        ))}
      </div>
    </section>
  )
}
