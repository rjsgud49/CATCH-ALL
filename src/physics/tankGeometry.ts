/** Single source of truth for aquarium geometry (physics + paint). */

export type Pt = { x: number; y: number }

export type TankInner = {
  left: number
  right: number
  top: number
  bottom: number
}

/** Outer glass silhouette, clockwise from rim-left. */
export const TANK = {
  left: 0.05,
  right: 0.95,
  rimTop: 0.07,
  lip: 0.12,
  bottom: 0.9,
  base: 0.94,
  /** Playable water volume (collision + clip). */
  inner: {
    left: 0.09,
    right: 0.91,
    top: 0.16,
    /**
     * Kept as fallback; tankInnerBounds derives floor from gravel
     * so pieces rest on (not in) the sand bed.
     */
    bottom: 0.81,
  },
  waterSurface: 0.145,
  /** Gravel height as fraction of tank height (from glass bottom up). */
  gravelTop: 0.08,
  /** Extra lift above gravel so sprites don't sink into sand. */
  floorPad: 0.012,
} as const

/** Y of the visible gravel surface. */
export function tankGravelY(height: number): number {
  return height * (TANK.bottom - TANK.gravelTop)
}

export function jarOutline(width: number, height: number): Pt[] {
  const left = width * TANK.left
  const right = width * TANK.right
  const top = height * TANK.rimTop
  const lip = height * TANK.lip
  const bottom = height * TANK.bottom
  const base = height * TANK.base

  return [
    { x: left + width * 0.015, y: top },
    { x: right - width * 0.015, y: top },
    { x: right, y: lip },
    { x: right - width * 0.008, y: bottom },
    { x: right - width * 0.04, y: base },
    { x: left + width * 0.04, y: base },
    { x: left + width * 0.008, y: bottom },
    { x: left, y: lip },
  ]
}

export function tankInnerBounds(width: number, height: number): TankInner {
  const i = TANK.inner
  const floor = tankGravelY(height) - height * TANK.floorPad
  return {
    left: width * i.left,
    right: width * i.right,
    top: height * i.top,
    bottom: floor,
  }
}

export function pathOutline(ctx: CanvasRenderingContext2D, outline: Pt[]) {
  outline.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  })
  ctx.closePath()
}
