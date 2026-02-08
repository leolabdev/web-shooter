import type { GameEvent, StateSnapshot } from '@shared/protocol'

export type FxState = {
  hitUntil?: number
  deathUntil?: number
  respawnUntil?: number
  lastAlive?: boolean
  lastSeenAt?: number
  lastX?: number
  lastY?: number
  ownerId?: string
  isEcho?: boolean
}

const HIT_MS = 120
const DEATH_MS = 350
const RESPAWN_MS = 400
const GC_MS = 2000

const eventTargetId = (event: GameEvent): string | null => {
  if (event.type === 'hit') return event.targetId
  if (event.type === 'death') return event.id
  return null
}

export const updateFxRegistry = (
  snapshot: StateSnapshot,
  fxMap: Map<string, FxState>,
  nowMs: number,
) => {
  const seen = new Set<string>()

  snapshot.players.forEach((player) => {
    const fx = fxMap.get(player.id) ?? {}
    if (fx.lastAlive === false && player.alive) {
      fx.respawnUntil = nowMs + RESPAWN_MS
    }
    fx.lastAlive = player.alive
    fx.lastSeenAt = nowMs
    fx.lastX = player.x
    fx.lastY = player.y
    fx.isEcho = player.isEcho
    fx.ownerId = player.ownerId
    fxMap.set(player.id, fx)
    seen.add(player.id)
  })

  snapshot.events.forEach((event) => {
    const id = eventTargetId(event)
    if (!id) return
    const fx = fxMap.get(id) ?? {}
    fx.lastSeenAt = nowMs
    if (event.type === 'hit') fx.hitUntil = nowMs + HIT_MS
    if (event.type === 'death') fx.deathUntil = nowMs + DEATH_MS
    fxMap.set(id, fx)
  })

  for (const [id, fx] of fxMap.entries()) {
    if (!seen.has(id) && fx.lastSeenAt && nowMs - fx.lastSeenAt > GC_MS) {
      fxMap.delete(id)
    }
  }
}
