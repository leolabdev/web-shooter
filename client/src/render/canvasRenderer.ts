import { ARENA, type PlayerState, type StateSnapshot } from '@shared/protocol'
import type { FxState } from './fx'

const COLORS = {
  background: '#0a0f1c',
  border: '#4b6ef5',
  playerStroke: '#09101d',
  bullet: '#ffd56b',
  text: '#e8f0ff',
  hpBg: 'rgba(8, 12, 24, 0.85)',
}

const hashString = (value: string) => {
  let hash = 5381
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return Math.abs(hash)
}

const colorFromId = (id: string) => {
  const hue = hashString(id) % 360
  return `hsl(${hue} 80% 55%)`
}

const drawHpBar = (
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  color: string,
  alpha: number,
) => {
  if (!player.alive) return
  const maxHp = player.isEcho ? 1 : 3
  const ratio = Math.max(0, Math.min(1, player.hp / maxHp))
  const barWidth = 36
  const barHeight = 5
  const x = player.x - barWidth / 2
  const y = player.y - player.r - 16

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = COLORS.hpBg
  ctx.fillRect(x, y, barWidth, barHeight)
  ctx.fillStyle = color
  ctx.fillRect(x, y, barWidth * ratio, barHeight)
  ctx.restore()
}

const drawRespawnPulse = (
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  color: string,
  nowMs: number,
  respawnUntil: number,
) => {
  if (!player.alive) return
  const remaining = respawnUntil - nowMs
  if (remaining <= 0) return
  const t = 1 - Math.min(1, remaining / 400)
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = (1 - t) * 0.7
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(player.x, player.y, player.r + 6 + t * 18, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  fx: FxState | undefined,
  nowMs: number,
) => {
  const baseId = player.isEcho ? player.ownerId ?? player.id : player.id
  const baseColor = colorFromId(baseId)
  const hitActive = (fx?.hitUntil ?? 0) > nowMs
  const deathUntil = fx?.deathUntil ?? 0
  const deathActive = deathUntil > nowMs
  const respawnUntil = fx?.respawnUntil ?? 0

  if (!player.alive && !deathActive) return

  let alpha = player.isEcho ? 0.35 : 1
  let radius = player.r

  if (deathActive) {
    const t = Math.max(0, Math.min(1, (deathUntil - nowMs) / 350))
    alpha = t * (player.isEcho ? 0.35 : 1)
    radius = player.r * (0.6 + t * 0.4)
  }

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = baseColor
  ctx.strokeStyle = COLORS.playerStroke
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(player.x, player.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  if (hitActive) {
    ctx.globalAlpha = Math.min(1, alpha + 0.4)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(player.x, player.y, radius + 2, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()

  drawRespawnPulse(ctx, player, baseColor, nowMs, respawnUntil)
  drawHpBar(ctx, player, baseColor, alpha)

  ctx.save()
  ctx.globalAlpha = player.isEcho ? 0.45 : 1
  ctx.fillStyle = COLORS.text
  ctx.font = '14px "Space Grotesk", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const nameY = player.y - player.r - 26
  ctx.fillText(player.name, player.x, nameY)
  ctx.restore()
}

export const renderSnapshot = (
  ctx: CanvasRenderingContext2D,
  snapshot: StateSnapshot,
  fxMap: Map<string, FxState>,
  nowMs: number,
) => {
  ctx.clearRect(0, 0, ARENA.w, ARENA.h)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, ARENA.w, ARENA.h)

  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, ARENA.w, ARENA.h)

  ctx.fillStyle = COLORS.bullet
  snapshot.bullets.forEach((bullet) => {
    ctx.beginPath()
    ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2)
    ctx.fill()
  })

  snapshot.players.forEach((player) => drawPlayer(ctx, player, fxMap.get(player.id), nowMs))
}
