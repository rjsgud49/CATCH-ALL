import type { CollectionRecord, CutoutMeta } from '../types/domain'

const API_BASE = ''

export type ServerProgress = (ratio: number, detail: string) => void

export type ServerCutoutMeta = CutoutMeta
export type ServerCollection = CollectionRecord

export async function checkServerHealth(): Promise<{
  ok: boolean
  ready: boolean
  storage: boolean
}> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, ready: false, storage: false }
    const data = (await res.json()) as { ok?: boolean; ready?: boolean; storage?: boolean }
    return {
      ok: Boolean(data.ok),
      ready: Boolean(data.ready),
      storage: Boolean(data.storage),
    }
  } catch {
    return { ok: false, ready: false, storage: false }
  }
}

/** Server-side nukki — model stays warm, much faster than browser WASM. */
export async function removeBackgroundServer(
  source: Blob,
  onProgress?: ServerProgress,
): Promise<Blob> {
  onProgress?.(0.05, '서버로 전송 중')
  const form = new FormData()
  const filename = source instanceof File ? source.name : 'image.png'
  form.append('file', source, filename)

  onProgress?.(0.2, '서버에서 배경 제거 중')
  const res = await fetch(`${API_BASE}/api/remove-background`, {
    method: 'POST',
    body: form,
  })

  if (res.status === 503) {
    throw new Error('서버 모델 준비 중')
  }
  if (!res.ok) {
    let detail = '서버 배경 제거 실패'
    try {
      const data = (await res.json()) as { detail?: string }
      if (data.detail) detail = data.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }

  onProgress?.(0.85, '결과 수신 중')
  const blob = await res.blob()
  onProgress?.(1, '완료')
  return blob
}

export async function uploadCutoutToServer(input: {
  id: string
  name: string
  collectionId: string
  createdAt: number
  width: number
  height: number
  vertices: { x: number; y: number }[]
  blob: Blob
}): Promise<ServerCutoutMeta | null> {
  try {
    const form = new FormData()
    form.append(
      'meta',
      JSON.stringify({
        id: input.id,
        name: input.name,
        collectionId: input.collectionId,
        createdAt: input.createdAt,
        width: input.width,
        height: input.height,
        vertices: input.vertices,
      }),
    )
    form.append('file', input.blob, `${input.id}.png`)
    const res = await fetch(`${API_BASE}/api/cutouts`, { method: 'POST', body: form })
    if (!res.ok) return null
    return (await res.json()) as ServerCutoutMeta
  } catch {
    return null
  }
}

export async function fetchServerCutouts(): Promise<ServerCutoutMeta[]> {
  try {
    const res = await fetch(`${API_BASE}/api/cutouts`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { cutouts?: ServerCutoutMeta[] }
    return Array.isArray(data.cutouts) ? data.cutouts : []
  } catch {
    return []
  }
}

export async function fetchServerCutoutImage(id: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${API_BASE}/api/cutouts/${encodeURIComponent(id)}/image`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

export async function patchServerCutout(
  id: string,
  patch: { name?: string; collectionId?: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/cutouts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteServerCutout(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/cutouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

export async function fetchServerCollections(): Promise<ServerCollection[]> {
  try {
    const res = await fetch(`${API_BASE}/api/collections`, { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { collections?: ServerCollection[] }
    return Array.isArray(data.collections) ? data.collections : []
  } catch {
    return []
  }
}

export async function createServerCollection(col: ServerCollection): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/collections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(col),
    })
    return res.ok || res.status === 409
  } catch {
    return false
  }
}
