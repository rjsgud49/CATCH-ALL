import type { ProgressSnapshot } from '../lib/progress'

type Props = {
  progress: ProgressSnapshot | null
  warming?: boolean
}

export function ProgressPanel({ progress, warming }: Props) {
  if (!progress) return null

  return (
    <div
      className={`progress-panel ${warming ? 'progress-panel--warm' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="progress-top">
        <span className="progress-phase">{progress.phaseLabel}</span>
        <span className="progress-pct">{progress.overall}%</span>
      </div>
      <div className="progress-track" aria-hidden>
        <div className="progress-fill" style={{ width: `${progress.overall}%` }} />
      </div>
      <div className="progress-meta">
        {progress.fileTotal > 0 ? (
          <span>
            {progress.fileIndex}/{progress.fileTotal}
            {progress.fileName ? ` · ${progress.fileName}` : ''}
          </span>
        ) : (
          <span>첫 실행을 위한 준비</span>
        )}
        <span className="progress-detail">{progress.detail}</span>
      </div>
    </div>
  )
}
