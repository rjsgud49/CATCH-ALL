import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShellNav } from './components/AppShellNav'
import { Onboarding, shouldShowOnboarding } from './components/Onboarding'
import { ToastStack, useToasts } from './components/ToastStack'
import { CatchPage } from './pages/CatchPage'
import { LibraryPage } from './pages/LibraryPage'
import { countCutouts, syncLibraryDual } from './lib/store'
import './App.css'

function AppRoutes() {
  const { toasts, push, dismiss } = useToasts()
  const [onboard, setOnboard] = useState(shouldShowOnboarding)
  const [libraryCount, setLibraryCount] = useState(0)
  const [refreshToken, setRefreshToken] = useState(0)
  const [pendingDropIds, setPendingDropIds] = useState<string[] | undefined>()

  const refreshLibraryCount = useCallback(async () => {
    try {
      const n = await countCutouts()
      setLibraryCount(n)
      setRefreshToken((t) => t + 1)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { pulled, pushed } = await syncLibraryDual()
        if (cancelled) return
        await refreshLibraryCount()
        if (pulled || pushed) {
          push(
            'ok',
            [
              pulled ? `서버→로컬 ${pulled}장` : null,
              pushed ? `로컬→서버 ${pushed}장` : null,
            ]
              .filter(Boolean)
              .join(' · ') + ' 동기화',
          )
        }
      } catch {
        if (!cancelled) await refreshLibraryCount()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshLibraryCount, push])

  const onLibraryChange = useCallback(() => {
    void refreshLibraryCount()
  }, [refreshLibraryCount])

  return (
    <>
      <div className="atmosphere" aria-hidden />
      <AppShellNav libraryCount={libraryCount} onHelp={() => setOnboard(true)} />
      <Routes>
        <Route
          path="/"
          element={
            <CatchPage
              push={push}
              onLibraryChange={onLibraryChange}
              pendingDropIds={pendingDropIds}
              onPendingDropConsumed={() => setPendingDropIds(undefined)}
            />
          }
        />
        <Route
          path="/library"
          element={
            <LibraryPage
              push={push}
              onLibraryChange={onLibraryChange}
              onDropToCatch={(ids) => setPendingDropIds(ids)}
              refreshToken={refreshToken}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <Onboarding open={onboard} onClose={() => setOnboard(false)} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
