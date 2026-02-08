import type { StateSnapshot } from '@shared/protocol'

type Interpolator = {
  pushSnapshot: (snapshot: StateSnapshot, nowClientMs?: number) => void
  getInterpolatedState: (nowClientMs: number) => StateSnapshot | null
}

const MAX_BUFFER = 30
const INTERP_DELAY_MS = 120
const OFFSET_SMOOTH = 0.1
const TELEPORT_DISTANCE = 220
const TELEPORT_SNAP_MS = 200
const RESPAWN_SNAP_MS = 250
const META_GC_MS = 5000

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const distance = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(ax - bx, ay - by)

export const createSnapshotInterpolator = (): Interpolator => {
  let buffer: StateSnapshot[] = []
  let offsetMs: number | null = null
  const meta = new Map<
    string,
    { lastAlive: boolean; lastPos: { x: number; y: number }; noInterpUntilMs: number; lastSeen: number }
  >()

  const pushSnapshot = (snapshot: StateSnapshot, nowClientMs = performance.now()) => {
    const newOffset = nowClientMs - snapshot.t
    offsetMs = offsetMs === null ? newOffset : lerp(offsetMs, newOffset, OFFSET_SMOOTH)

    snapshot.players.forEach((player) => {
      const prev = meta.get(player.id)
      const next = {
        lastAlive: player.alive,
        lastPos: { x: player.x, y: player.y },
        noInterpUntilMs: prev?.noInterpUntilMs ?? 0,
        lastSeen: snapshot.t,
      }

      if (prev) {
        if (!prev.lastAlive && player.alive) {
          next.noInterpUntilMs = snapshot.t + RESPAWN_SNAP_MS
        } else if (
          distance(prev.lastPos.x, prev.lastPos.y, player.x, player.y) > TELEPORT_DISTANCE
        ) {
          next.noInterpUntilMs = snapshot.t + TELEPORT_SNAP_MS
        }
      }

      meta.set(player.id, next)
    })

    for (const [id, entry] of meta.entries()) {
      if (snapshot.t - entry.lastSeen > META_GC_MS) {
        meta.delete(id)
      }
    }

    const last = buffer[buffer.length - 1]
    if (!last || snapshot.t >= last.t) {
      buffer.push(snapshot)
    } else {
      const index = buffer.findIndex((entry) => entry.t > snapshot.t)
      if (index === -1) buffer.push(snapshot)
      else buffer.splice(index, 0, snapshot)
    }

    if (buffer.length > MAX_BUFFER) {
      buffer = buffer.slice(buffer.length - MAX_BUFFER)
    }
  }

  const getInterpolatedState = (nowClientMs: number): StateSnapshot | null => {
    if (buffer.length === 0) return null
    if (buffer.length === 1) return buffer[0]
    if (offsetMs === null) return buffer[buffer.length - 1]

    const renderTimeServer = nowClientMs - INTERP_DELAY_MS - offsetMs
    const first = buffer[0]
    const last = buffer[buffer.length - 1]

    if (renderTimeServer <= first.t) return first
    if (renderTimeServer >= last.t) return last

    let aIndex = 0
    for (let i = 0; i < buffer.length - 1; i += 1) {
      if (buffer[i].t <= renderTimeServer && renderTimeServer <= buffer[i + 1].t) {
        aIndex = i
        break
      }
    }

    const a = buffer[aIndex]
    const b = buffer[aIndex + 1]
    const span = b.t - a.t
    const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTimeServer - a.t) / span)) : 0

    const playersA = new Map(a.players.map((player) => [player.id, player]))
    const playersB = new Map(b.players.map((player) => [player.id, player]))
    const allPlayerIds = new Set([...playersA.keys(), ...playersB.keys()])
    const players = Array.from(allPlayerIds).map((id) => {
      const pa = playersA.get(id)
      const pb = playersB.get(id)
      const base = pb ?? pa
      if (!base) {
        throw new Error('Missing player base snapshot')
      }
      const metaEntry = meta.get(id)
      const snapToLatest =
        (metaEntry?.noInterpUntilMs && renderTimeServer <= metaEntry.noInterpUntilMs) ||
        (pa && pb && !pa.alive && pb.alive) ||
        (pa && pb && distance(pa.x, pa.y, pb.x, pb.y) > TELEPORT_DISTANCE)
      const x = pa && pb && !snapToLatest ? lerp(pa.x, pb.x, alpha) : base.x
      const y = pa && pb && !snapToLatest ? lerp(pa.y, pb.y, alpha) : base.y
      return {
        ...base,
        x,
        y,
      }
    })

    const bulletsA = new Map(a.bullets.map((bullet) => [bullet.id, bullet]))
    const bulletsB = new Map(b.bullets.map((bullet) => [bullet.id, bullet]))
    const allBulletIds = new Set([...bulletsA.keys(), ...bulletsB.keys()])
    const bullets = Array.from(allBulletIds).map((id) => {
      const ba = bulletsA.get(id)
      const bb = bulletsB.get(id)
      const base = bb ?? ba
      if (!base) {
        throw new Error('Missing bullet base snapshot')
      }
      const x = ba && bb ? lerp(ba.x, bb.x, alpha) : base.x
      const y = ba && bb ? lerp(ba.y, bb.y, alpha) : base.y
      return {
        ...base,
        x,
        y,
      }
    })

    return {
      ...b,
      players,
      bullets,
    }
  }

  return { pushSnapshot, getInterpolatedState }
}
