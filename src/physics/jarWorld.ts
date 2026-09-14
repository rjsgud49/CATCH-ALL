import Matter from 'matter-js'
import type { CutoutAsset } from '../lib/makeCutout'
import { tankInnerBounds } from './tankGeometry'

const { Engine, World, Bodies, Body, Composite, Mouse, MouseConstraint, Query, Vertices, Events } =
  Matter

export type CutoutBodyData = {
  previewUrl: string
  textureUrl: string
}

export type JarWorld = {
  engine: Matter.Engine
  renderWidth: number
  renderHeight: number
  addCutout: (asset: CutoutAsset) => Matter.Body
  shake: (dx: number, dy: number) => void
  clearCutouts: () => void
  dispose: () => void
  getCutoutBodies: () => Matter.Body[]
  setMouseElement: (element: HTMLElement) => void
  hitTest: (x: number, y: number) => Matter.Body | null
}

const MAX_BODY_SIZE = 84
const WALL_THICKNESS = 48
const GRAB = 0x0001
const WALL = 0x0002
const BUSY = 0x0004

function buildJarWalls(width: number, height: number): Matter.Body[] {
  const inner = tankInnerBounds(width, height)
  const t = WALL_THICKNESS
  const midY = (inner.top + inner.bottom) / 2
  const midX = (inner.left + inner.right) / 2
  const wallH = inner.bottom - inner.top + t
  const wallW = inner.right - inner.left + t

  const wallOpts = {
    isStatic: true as const,
    friction: 1,
    restitution: 0,
    slop: 0,
    collisionFilter: { category: WALL, mask: 0xffffffff, group: 0 },
    render: { visible: false },
  }

  return [
    Bodies.rectangle(inner.left - t / 2, midY, t, wallH, { ...wallOpts, label: 'wall-left' }),
    Bodies.rectangle(inner.right + t / 2, midY, t, wallH, { ...wallOpts, label: 'wall-right' }),
    Bodies.rectangle(midX, inner.bottom + t / 2, wallW, t, { ...wallOpts, label: 'wall-bottom' }),
    Bodies.rectangle(inner.left + width * 0.12, inner.top + 4, width * 0.2, t * 0.55, {
      ...wallOpts,
      angle: 0.35,
      label: 'wall-lip-l',
    }),
    Bodies.rectangle(inner.right - width * 0.12, inner.top + 4, width * 0.2, t * 0.55, {
      ...wallOpts,
      angle: -0.35,
      label: 'wall-lip-r',
    }),
  ]
}

function createSilhouetteBody(x: number, y: number, asset: CutoutAsset): Matter.Body {
  const scale = MAX_BODY_SIZE / Math.max(asset.width, asset.height)
  const scaled = asset.vertices.map((v) => ({ x: v.x * scale, y: v.y * scale }))

  let cx = 0
  let cy = 0
  for (const v of asset.vertices) {
    cx += v.x
    cy += v.y
  }
  cx /= Math.max(1, asset.vertices.length)
  cy /= Math.max(1, asset.vertices.length)

  const options: Matter.IChamferableBodyDefinition = {
    restitution: 0.05,
    friction: 0.85,
    frictionAir: 0.035,
    density: 0.0024,
    slop: 0.01,
    label: 'cutout',
    collisionFilter: { category: GRAB, mask: 0xffffffff, group: 0 },
    render: {
      sprite: {
        texture: asset.textureUrl,
        xScale: scale,
        yScale: scale,
        xOffset: cx / asset.width,
        yOffset: cy / asset.height,
      } as Matter.IBodyRenderOptionsSprite & { xOffset: number; yOffset: number },
      fillStyle: 'transparent',
      strokeStyle: 'transparent',
      lineWidth: 0,
    },
  }

  let body: Matter.Body | undefined
  try {
    const hull = Vertices.hull(scaled as unknown as Matter.Vertex[])
    if (hull.length >= 3) {
      body = Bodies.fromVertices(x, y, [hull], options, true) ?? undefined
    }
  } catch {
    body = undefined
  }

  if (!body) {
    body = Bodies.rectangle(x, y, asset.width * scale, asset.height * scale, options)
  }

  ;(body as Matter.Body & { cutout?: CutoutBodyData }).cutout = {
    previewUrl: asset.previewUrl,
    textureUrl: asset.textureUrl,
  }

  return body
}

export function createJarWorld(renderWidth: number, renderHeight: number): JarWorld {
  const engine = Engine.create({
    gravity: { x: 0, y: 1.05, scale: 0.001 },
  })
  engine.positionIterations = 16
  engine.velocityIterations = 12

  World.add(engine.world, buildJarWalls(renderWidth, renderHeight))

  const inner = tankInnerBounds(renderWidth, renderHeight)
  const cutouts: Matter.Body[] = []
  let dropIndex = 0
  let mouseConstraint: Matter.MouseConstraint | null = null

  const containBodies = () => {
    for (const body of cutouts) {
      const b = body.bounds
      let dx = 0
      let dy = 0

      if (b.min.x < inner.left) dx = inner.left - b.min.x
      else if (b.max.x > inner.right) dx = inner.right - b.max.x

      if (b.min.y < inner.top) dy = inner.top - b.min.y
      else if (b.max.y > inner.bottom) dy = inner.bottom - b.max.y

      if (dx !== 0 || dy !== 0) {
        Body.setPosition(body, {
          x: body.position.x + dx,
          y: body.position.y + dy,
        })

        let vx = body.velocity.x
        let vy = body.velocity.y
        if (dx > 0 && vx < 0) vx = 0
        if (dx < 0 && vx > 0) vx = 0
        if (dy > 0 && vy < 0) vy = 0
        if (dy < 0 && vy > 0) vy = 0
        Body.setVelocity(body, { x: vx * 0.35, y: vy * 0.35 })
        Body.setAngularVelocity(body, body.angularVelocity * 0.5)
      }

      // Soft settle: if resting on floor with downward velocity, kill it
      // so Matter slop doesn't keep nudging pieces into the sand.
      if (b.max.y >= inner.bottom - 0.5 && body.velocity.y > 0) {
        Body.setVelocity(body, { x: body.velocity.x * 0.92, y: 0 })
        if (b.max.y > inner.bottom) {
          Body.setPosition(body, {
            x: body.position.x,
            y: body.position.y - (b.max.y - inner.bottom),
          })
        }
      }

      if (
        body.position.x < inner.left ||
        body.position.x > inner.right ||
        body.position.y < inner.top ||
        body.position.y > inner.bottom
      ) {
        Body.setPosition(body, {
          x: Math.min(inner.right - 8, Math.max(inner.left + 8, body.position.x)),
          y: Math.min(inner.bottom - 8, Math.max(inner.top + 8, body.position.y)),
        })
        Body.setVelocity(body, { x: 0, y: 0.5 })
      }
    }
  }

  Events.on(engine, 'afterUpdate', containBodies)

  const addCutout = (asset: CutoutAsset): Matter.Body => {
    const span = Math.max(40, inner.right - inner.left - 40)
    const x = inner.left + 20 + ((dropIndex * 53) % span)
    const y = inner.top + 28
    dropIndex += 1

    const body = createSilhouetteBody(x, y, asset)
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.04)
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 0.5, y: 1.4 })

    cutouts.push(body)
    World.add(engine.world, body)
    containBodies()
    return body
  }

  const shake = (dx: number, dy: number) => {
    const forceScale = 0.00028
    for (const body of cutouts) {
      Body.applyForce(body, body.position, {
        x: dx * forceScale * body.mass,
        y: Math.min(dy, 36) * forceScale * body.mass,
      })
      Body.setAngularVelocity(body, body.angularVelocity + dx * 0.0007)
      Body.setVelocity(body, {
        x: body.velocity.x + dx * 0.08,
        y: body.velocity.y + Math.min(dy, 36) * 0.06,
      })
    }
  }

  const clearCutouts = () => {
    for (const body of cutouts) World.remove(engine.world, body)
    cutouts.length = 0
    dropIndex = 0
  }

  const hitTest = (x: number, y: number): Matter.Body | null => {
    return Query.point(cutouts, { x, y })[0] ?? null
  }

  const setMouseElement = (element: HTMLElement) => {
    if (mouseConstraint) {
      World.remove(engine.world, mouseConstraint)
      mouseConstraint = null
    }
    const mouse = Mouse.create(element)
    mouse.pixelRatio = window.devicePixelRatio || 1
    mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: {
        stiffness: 0.22,
        damping: 0.12,
        render: { visible: false },
      },
      collisionFilter: { category: GRAB, mask: GRAB, group: 0 },
    })

    Events.on(mouseConstraint, 'startdrag', (event) => {
      const grabbed = (event as { body?: Matter.Body }).body
      if (!grabbed) return
      for (const body of cutouts) {
        const mine = body.id === grabbed.id
        body.collisionFilter.category = mine ? GRAB : BUSY
        body.collisionFilter.mask = 0xffffffff
      }
    })

    Events.on(mouseConstraint, 'enddrag', () => {
      for (const body of cutouts) {
        body.collisionFilter.category = GRAB
        body.collisionFilter.mask = 0xffffffff
      }
    })

    World.add(engine.world, mouseConstraint)
  }

  const dispose = () => {
    Events.off(engine, 'afterUpdate', containBodies)
    if (mouseConstraint) {
      World.remove(engine.world, mouseConstraint)
      mouseConstraint = null
    }
    Composite.clear(engine.world, false)
    Engine.clear(engine)
    cutouts.length = 0
  }

  return {
    engine,
    renderWidth,
    renderHeight,
    addCutout,
    shake,
    clearCutouts,
    dispose,
    getCutoutBodies: () => cutouts,
    setMouseElement,
    hitTest,
  }
}

export { jarOutline, tankInnerBounds } from './tankGeometry'
