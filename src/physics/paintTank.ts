import { jarOutline, pathOutline, TANK, tankGravelY } from './tankGeometry'

/** Aquarium glass drawn behind sprites (destination-over). */
export function paintTankBehind(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const outline = jarOutline(width, height)
  const waterTop = height * TANK.waterSurface
  const bottom = height * TANK.bottom
  const base = height * TANK.base

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

  const gravelY = tankGravelY(height)
  ctx.beginPath()
  ctx.moveTo(width * 0.085, gravelY)
  ctx.lineTo(width * 0.915, gravelY)
  ctx.lineTo(width * 0.93, bottom - 4)
  ctx.lineTo(width * 0.07, bottom - 4)
  ctx.closePath()
  const gravel = ctx.createLinearGradient(0, gravelY, 0, bottom)
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
export function paintTankFront(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const outline = jarOutline(width, height)
  const top = outline[0].y
  const lip = height * TANK.lip

  ctx.save()

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

  ctx.beginPath()
  ctx.moveTo(outline[6].x, height * 0.88)
  ctx.lineTo(outline[3].x, height * 0.88)
  ctx.lineTo(outline[4].x, height * TANK.base)
  ctx.lineTo(outline[5].x, height * TANK.base)
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
  ctx.moveTo(width * 0.1, height * TANK.waterSurface)
  ctx.lineTo(width * 0.9, height * TANK.waterSurface)
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
