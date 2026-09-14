import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import Matter from 'matter-js'
import { createJarWorld, type CutoutBodyData, type JarWorld } from '../physics/jarWorld'
import { tankInnerBounds } from '../physics/tankGeometry'
import { paintTankBehind, paintTankFront } from '../physics/paintTank'
import type { CutoutAsset } from '../lib/makeCutout'

const { Render, Runner } = Matter

export type JarCanvasHandle = {
  addCutout: (asset: CutoutAsset) => void
  shake: () => void
  clear: () => void
}

type Props = {
  className?: string
  empty?: boolean
  busy?: boolean
  onCutoutClick?: (previewUrl: string) => void
}

function canvasPoint(
  canvas: HTMLCanvasElement,
  e: PointerEvent,
  logicalW: number,
  logicalH: number,
) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * logicalW,
    y: ((e.clientY - rect.top) / rect.height) * logicalH,
  }
}

function fitTankSize(host: HTMLElement) {
  const maxW = Math.min(960, Math.max(280, host.clientWidth || 720))
  const maxH = Math.max(200, host.clientHeight || Math.round(maxW * 0.62))
  let width = maxW
  let height = Math.round(width * 0.62)
  if (height > maxH) {
    height = maxH
    width = Math.max(280, Math.round(height / 0.62))
  }
  return { width, height }
}

export const JarCanvas = forwardRef<JarCanvasHandle, Props>(function JarCanvas(
  { className, empty, busy, onCutoutClick },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<JarWorld | null>(null)
  const onClickRef = useRef(onCutoutClick)
  onClickRef.current = onCutoutClick

  useImperativeHandle(ref, () => ({
    addCutout(asset: CutoutAsset) {
      worldRef.current?.addCutout(asset)
    },
    shake() {
      worldRef.current?.shake((Math.random() - 0.5) * 110, -28 - Math.random() * 42)
    },
    clear() {
      worldRef.current?.clearCutouts()
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const { width, height } = fitTankSize(host)
    const world = createJarWorld(width, height)
    worldRef.current = world

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.className = 'jar-canvas-el'
    host.appendChild(canvas)

    const render = Render.create({
      canvas,
      engine: world.engine,
      options: {
        width,
        height,
        wireframes: false,
        background: 'transparent',
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      },
    })

    const paintJar = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const inner = tankInnerBounds(width, height)
      ctx.save()
      ctx.globalCompositeOperation = 'destination-in'
      ctx.beginPath()
      ctx.rect(inner.left, inner.top, inner.right - inner.left, inner.bottom - inner.top)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.restore()
      paintTankBehind(ctx, width, height)
      paintTankFront(ctx, width, height)
    }

    Matter.Events.on(render, 'afterRender', paintJar)
    world.setMouseElement(canvas)

    let lastPointer: { x: number; y: number } | null = null
    let downCanvas: { x: number; y: number } | null = null
    let moved = false
    let hitOnDown: Matter.Body | null = null

    const onPointerDown = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY }
      downCanvas = canvasPoint(canvas, e, width, height)
      moved = false
      hitOnDown = world.hitTest(downCanvas.x, downCanvas.y)
      canvas.setPointerCapture(e.pointerId)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!lastPointer || e.buttons === 0) return
      const dx = e.clientX - lastPointer.x
      const dy = e.clientY - lastPointer.y
      if (Math.hypot(dx, dy) > 6) {
        moved = true
        if (!hitOnDown) world.shake(dx * 2.2, Math.min(dy * 2.2, 18))
      }
      lastPointer = { x: e.clientX, y: e.clientY }
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!moved && hitOnDown) {
        const data = (hitOnDown as Matter.Body & { cutout?: CutoutBodyData }).cutout
        if (data?.previewUrl) onClickRef.current?.(data.previewUrl)
      }
      lastPointer = null
      downCanvas = null
      hitOnDown = null
      moved = false
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)

    const runner = Runner.create()
    Runner.run(runner, world.engine)
    Render.run(render)

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      Matter.Events.off(render, 'afterRender', paintJar)
      Render.stop(render)
      Runner.stop(runner)
      world.dispose()
      render.canvas.remove()
      worldRef.current = null
    }
  }, [])

  return (
    <div ref={hostRef} className={className} aria-label="수집 어항 물리 영역">
      {empty && !busy && (
        <div className="jar-empty" aria-hidden>
          <p>이미지를 넣으면</p>
          <p>어항 안에 쌓여요</p>
        </div>
      )}
      {busy && <div className="jar-busy" aria-hidden />}
    </div>
  )
})
