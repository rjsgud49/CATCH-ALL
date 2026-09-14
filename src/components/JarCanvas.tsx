import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import Matter from 'matter-js'
import { createJarWorld, jarOutline, tankInnerBounds, type JarWorld } from '../physics/jarWorld'
import type { CutoutAsset } from '../lib/makeCutout'
import type { CutoutBodyData } from '../physics/jarWorld'

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

function pathOutline(
  ctx: CanvasRenderingContext2D,
  outline: { x: number; y: number }[],
) {
  outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.closePath()
}

/** Aquarium glass behind sprites (Matter clears beforeRender paints). */
function paintTankBehind(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const outline = jarOutline(width, height)
  const waterTop = height * 0.14
  const bottom = height * 0.9
  const base = height * 0.94

  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'

  ctx.beginPath()
  ctx.ellipse(width / 2, height * 0.965, width * 0.42, height * 0.028, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(18, 36, 40, 0.2)'
  ctx.fill()

  ctx.beginPath()
  pathOutline(ctx, outline)
  const glass = ctx.createLinearGradient(0, 0, 0, height)
  glass.addColorStop(0, 'rgba(186, 220, 224, 0.55)')
  glass.addColorStop(0.35, 'rgba(120, 178, 186, 0.42)')
  glass.addColorStop(0.75, 'rgba(72, 132, 142, 0.48)')
  glass.addColorStop(1, 'rgba(48, 88, 96, 0.62)')
  ctx.fillStyle = glass
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(width * 0.07, waterTop)
  ctx.lineTo(width * 0.93, waterTop)
  ctx.lineTo(width * 0.92, bottom - 6)
  ctx.lineTo(width * 0.08, bottom - 6)
  ctx.closePath()
  const water = ctx.createLinearGradient(0, waterTop, 0, bottom)
  water.addColorStop(0, 'rgba(90, 170, 185, 0.28)')
  water.addColorStop(0.55, 'rgba(40, 110, 125, 0.38)')
  water.addColorStop(1, 'rgba(22, 70, 82, 0.55)')
  ctx.fillStyle = water
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(width * 0.085, bottom - height * 0.08)
  ctx.lineTo(width * 0.915, bottom - height * 0.08)
  ctx.lineTo(width * 0.93, bottom - 4)
  ctx.lineTo(width * 0.07, bottom - 4)
  ctx.closePath()
  const gravel = ctx.createLinearGradient(0, bottom - height * 0.08, 0, bottom)
  gravel.addColorStop(0, 'rgba(120, 110, 85, 0.45)')
  gravel.addColorStop(1, 'rgba(70, 62, 48, 0.7)')
  ctx.fillStyle = gravel
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(outline[6].x, bottom)
  ctx.lineTo(outline[3].x, bottom)
  ctx.lineTo(outline[4].x, base)
  ctx.lineTo(outline[5].x, base)
  ctx.closePath()
  ctx.fillStyle = '#2c3e42'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(width * 0.12, height * 0.2)
  ctx.quadraticCurveTo(width * 0.1, height * 0.5, width * 0.14, height * 0.78)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 8
  ctx.lineCap = 'round'
  ctx.stroke()

  ctx.beginPath()
  pathOutline(ctx, outline)
  ctx.strokeStyle = 'rgba(30, 55, 60, 0.55)'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.restore()
}

/** Frame + side glass in front of edge-clipped pieces. */
function paintTankFront(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const outline = jarOutline(width, height)
  const top = outline[0].y
  const lip = height * 0.12

  ctx.save()

  // Thicker side glass so clipped sprites never show past the frame
  const leftGlass = ctx.createLinearGradient(width * 0.04, 0, width * 0.14, 0)
  leftGlass.addColorStop(0, 'rgba(210, 235, 238, 0.92)')
  leftGlass.addColorStop(0.45, 'rgba(140, 180, 188, 0.55)')
  leftGlass.addColorStop(1, 'rgba(120, 160, 168, 0)')
  ctx.beginPath()
  ctx.moveTo(outline[7].x, outline[7].y)
  ctx.lineTo(outline[0].x, outline[0].y)
  ctx.lineTo(width * 0.12, top + 8)
  ctx.lineTo(width * 0.105, height * 0.88)
  ctx.closePath()
  ctx.fillStyle = leftGlass
  ctx.fill()

  const rightGlass = ctx.createLinearGradient(width * 0.96, 0, width * 0.86, 0)
  rightGlass.addColorStop(0, 'rgba(210, 235, 238, 0.92)')
  rightGlass.addColorStop(0.45, 'rgba(140, 180, 188, 0.55)')
  rightGlass.addColorStop(1, 'rgba(120, 160, 168, 0)')
  ctx.beginPath()
  ctx.moveTo(outline[1].x, outline[1].y)
  ctx.lineTo(outline[2].x, outline[2].y)
  ctx.lineTo(width * 0.895, height * 0.88)
  ctx.lineTo(width * 0.88, top + 8)
  ctx.closePath()
  ctx.fillStyle = rightGlass
  ctx.fill()

  // Bottom frame cover
  ctx.beginPath()
  ctx.moveTo(outline[6].x, height * 0.88)
  ctx.lineTo(outline[3].x, height * 0.88)
  ctx.lineTo(outline[4].x, height * 0.94)
  ctx.lineTo(outline[5].x, height * 0.94)
  ctx.closePath()
  ctx.fillStyle = 'rgba(44, 62, 66, 0.95)'
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(outline[0].x - 4, top - 4)
  ctx.lineTo(outline[1].x + 4, top - 4)
  ctx.lineTo(outline[2].x + 2, lip + 2)
  ctx.lineTo(outline[7].x - 2, lip + 2)
  ctx.closePath()
  const rim = ctx.createLinearGradient(0, top - 4, 0, lip + 2)
  rim.addColorStop(0, '#d8ecee')
  rim.addColorStop(0.5, '#8eb4ba')
  rim.addColorStop(1, '#3d5c62')
  ctx.fillStyle = rim
  ctx.fill()
  ctx.strokeStyle = 'rgba(24, 44, 48, 0.5)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(width * 0.1, height * 0.145)
  ctx.lineTo(width * 0.9, height * 0.145)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  pathOutline(ctx, outline)
  ctx.strokeStyle = 'rgba(22, 42, 48, 0.7)'
  ctx.lineWidth = 3.5
  ctx.stroke()

  ctx.restore()
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
      worldRef.current?.shake((Math.random() - 0.5) * 48, -12 - Math.random() * 18)
    },
    clear() {
      worldRef.current?.clearCutouts()
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const maxW = Math.min(960, Math.max(280, host.clientWidth || 720))
    const maxH = Math.max(200, host.clientHeight || Math.round(maxW * 0.62))
    let width = maxW
    let height = Math.round(width * 0.62)
    if (height > maxH) {
      height = maxH
      width = Math.max(280, Math.round(height / 0.62))
    }

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

      // Hard visual clip: erase anything drawn outside the water volume.
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
      if (!moved && hitOnDown && downCanvas) {
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
