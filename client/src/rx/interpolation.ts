import type { StateSnapshot } from '@shared/protocol'

type Interpolator = {
  pushSnapshot: (snapshot: StateSnapshot, nowClientMs?: number) => void
  getInterpolatedState: (nowClientMs: number) => StateSnapshot | null
}

const MAX_BUFFER = 30
const INTERP_DELAY_MS = 120
const OFFSET_SMOOTH = 0.1

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const createSnapshotInterpolator = (): Interpolator => {
  let buffer: StateSnapshot[] = []
  let offsetMs: number | null = null

  const pushSnapshot = (snapshot: StateSnapshot, nowClientMs = performance.now()) => {
    const newOffset = nowClientMs - snapshot.t
    offsetMs = offsetMs === null ? newOffset : lerp(offsetMs, newOffset, OFFSET_SMOOTH)

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
      const x = pa && pb ? lerp(pa.x, pb.x, alpha) : base.x
      const y = pa && pb ? lerp(pa.y, pb.y, alpha) : base.y
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
