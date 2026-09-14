import { removeBackground as imglyRemove } from '@imgly/background-removal'

export type ProgressCallback = (key: string, current: number, total: number) => void

export async function removeBackground(
  source: Blob | string | HTMLImageElement,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  return imglyRemove(source, {
    model: 'isnet_quint8',
    output: {
      format: 'image/png',
      quality: 0.9,
    },
    progress: onProgress,
  })
}
