export type PipelinePhase =
  | 'queue'
  | 'model'
  | 'remove'
  | 'crop'
  | 'drop'
  | 'warmup'

export type ProgressSnapshot = {
  overall: number
  phase: PipelinePhase
  phaseLabel: string
  fileName: string
  fileIndex: number
  fileTotal: number
  detail: string
}

const PHASE_LABEL: Record<PipelinePhase, string> = {
  queue: '대기',
  model: 'AI 모델',
  remove: '배경 제거',
  crop: '누끼 크롭',
  drop: '수집함에 담기',
  warmup: '엔진 준비',
}

/** Map a single-file internal ratio (0–1) onto overall batch progress. */
export function batchProgress(
  fileIndex: number,
  fileTotal: number,
  withinFile: number,
): number {
  if (fileTotal <= 0) return 0
  const clamped = Math.min(1, Math.max(0, withinFile))
  return Math.round(((fileIndex + clamped) / fileTotal) * 100)
}

export function phaseLabel(phase: PipelinePhase): string {
  return PHASE_LABEL[phase]
}

/** Convert @imgly progress callback into 0–1 within the remove stage. */
export function mapImglyProgress(
  key: string,
  current: number,
  total: number,
): { phase: PipelinePhase; withinRemove: number; detail: string } {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  const pct = Math.round(ratio * 100)
  const lower = key.toLowerCase()

  if (lower.includes('fetch') || lower.includes('download') || lower.includes('load')) {
    return {
      phase: 'model',
      withinRemove: 0.05 + ratio * 0.35,
      detail: `모델 다운로드 ${pct}%`,
    }
  }
  if (lower.includes('compute') || lower.includes('infer') || lower.includes('session')) {
    return {
      phase: 'remove',
      withinRemove: 0.4 + ratio * 0.5,
      detail: `피사체 분리 ${pct}%`,
    }
  }
  return {
    phase: 'remove',
    withinRemove: 0.4 + ratio * 0.45,
    detail: `${key} ${pct}%`,
  }
}

export function snapshot(partial: Omit<ProgressSnapshot, 'phaseLabel'>): ProgressSnapshot {
  return { ...partial, phaseLabel: phaseLabel(partial.phase) }
}
