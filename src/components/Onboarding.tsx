import { useState } from 'react'

const STORAGE_KEY = 'catch-all-onboarded-v2'

const STEPS = [
  {
    title: '사진을 넣어요',
    body: '여러 장을 한꺼번에 올리거나 화면 어디에든 끌어다 놓을 수 있어요.',
  },
  {
    title: '누끼로 따져요',
    body: '배경을 지우고 피사체만 남겨, 넓은 수집 어항 안으로 떨어뜨립니다.',
  },
  {
    title: '라이브러리에 모아요',
    body: '모은 누끼는 새로고침해도 Library에 남아요. 묶어 ZIP으로 꺼내 쓰세요.',
  },
]

type Props = {
  open: boolean
  onClose: () => void
}

export function Onboarding({ open, onClose }: Props) {
  const [step, setStep] = useState(0)
  if (!open) return null

  const last = step >= STEPS.length - 1
  const current = STEPS[step]

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    onClose()
  }

  return (
    <div className="onboard-backdrop" role="dialog" aria-modal="true" aria-label="이용 안내">
      <div className="onboard-panel">
        <p className="onboard-kicker">
          {step + 1} / {STEPS.length}
        </p>
        <h2 className="onboard-title">{current.title}</h2>
        <p className="onboard-body">{current.body}</p>
        <div className="onboard-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? 'onboard-dot onboard-dot--on' : 'onboard-dot'} />
          ))}
        </div>
        <div className="onboard-actions">
          <button type="button" className="ghost-btn" onClick={finish}>
            건너뛰기
          </button>
          {last ? (
            <button type="button" className="cta onboard-cta" onClick={finish}>
              시작하기
            </button>
          ) : (
            <button type="button" className="cta onboard-cta" onClick={() => setStep((s) => s + 1)}>
              다음
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1'
  } catch {
    return true
  }
}
