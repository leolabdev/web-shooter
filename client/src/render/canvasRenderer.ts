import { ARENA, type PlayerState, type StateSnapshot } from '@shared/protocol'
import { colorFromId } from './colors'
import type { FxState } from './fx'

const COLORS = {
  background: '#0a0f1c',
  border: '#4b6ef5',
  playerStroke: '#09101d',
  bullet: '#ffd56b',
  text: '#e8f0ff',
  hpBg: 'rgba(8, 12, 24, 0.85)',
  pickupEcho: '#7ef1ff',
  pickupTime: '#7cffb3',
  pickupDash: '#ffb86b',
  pickupNova: '#ffd66b',
  pickupShield: '#7cffb3',
  pickupRift: '#ff7ad9',
  pickupStrike: '#ff9b6b',
  pickupPortals: '#7aa5ff',
  pickupBouncer: '#ffb2f0',
  shieldRing: 'rgba(124, 255, 179, 0.7)',
  beam: 'rgba(255, 225, 140, 0.85)',
  portal: 'rgba(122, 165, 255, 0.85)',
}

const pickupLabel = (type: StateSnapshot['pickups'][number]['type']) => {
  if (type === 'echo') return 'E'
  if (type === 'time_bubble') return 'T'
  if (type === 'shield') return 'S'
  if (type === 'rift_sniper') return 'R'
  if (type === 'pulse_nova') return 'N'
  if (type === 'orbital_strike') return 'O'
  if (type === 'linked_portals') return 'P'
  if (type === 'annihilation_bouncer') return 'B'
  return 'D'
}

const pickupColor = (type: StateSnapshot['pickups'][number]['type']) => {
  if (type === 'echo') return COLORS.pickupEcho
  if (type === 'time_bubble') return COLORS.pickupTime
  if (type === 'shield') return COLORS.pickupShield
  if (type === 'rift_sniper') return COLORS.pickupRift
  if (type === 'pulse_nova') return COLORS.pickupNova
  if (type === 'orbital_strike') return COLORS.pickupStrike
  if (type === 'linked_portals') return COLORS.pickupPortals
  if (type === 'annihilation_bouncer') return COLORS.pickupBouncer
  return COLORS.pickupDash
}

const drawHpBar = (
  ctx: CanvasRenderingContext2D,
  player: PlayerState,
  color: string,
  alpha: number,
) => {
  if (!player.alive) return
  const maxHp = player.maxHp || 1
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

  if ((player.shieldHp ?? 0) > 0) {
    ctx.globalAlpha = Math.min(1, alpha + 0.2)
    ctx.strokeStyle = COLORS.shieldRing
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(player.x, player.y, radius + 6, 0, Math.PI * 2)
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

export type BeamFx = {
  from: { x: number; y: number }
  to: { x: number; y: number }
  until: number
}

export type NovaFx = {
  x: number
  y: number
  until: number
}

export type StrikeMarkFx = {
  id: string
  x: number
  y: number
  startedAt: number
  explodeAt: number
}

export type StrikeBoomFx = {
  x: number
  y: number
  r: number
  until: number
}

export type StrikePreview = {
  x: number
  y: number
  r: number
}

export type PortalPreview = {
  x: number
  y: number
  r: number
}

export const renderSnapshot = (
  ctx: CanvasRenderingContext2D,
  snapshot: StateSnapshot,
  fxMap: Map<string, FxState>,
  nowMs: number,
  beams: BeamFx[] = [],
  novas: NovaFx[] = [],
  strikeMarks: StrikeMarkFx[] = [],
  strikeBooms: StrikeBoomFx[] = [],
  strikePreview?: StrikePreview,
  portalPreview?: PortalPreview,
) => {
  ctx.clearRect(0, 0, ARENA.w, ARENA.h)
  ctx.fillStyle = COLORS.background
  ctx.fillRect(0, 0, ARENA.w, ARENA.h)

  ctx.strokeStyle = COLORS.border
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, ARENA.w, ARENA.h)

  snapshot.zones.forEach((zone) => {
    if (zone.kind !== 'time_bubble') return
    ctx.save()
    ctx.fillStyle = 'rgba(102, 255, 190, 0.12)'
    ctx.strokeStyle = 'rgba(102, 255, 190, 0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  })

  snapshot.portals.forEach((portal) => {
    ctx.save()
    ctx.strokeStyle = COLORS.portal
    ctx.fillStyle = 'rgba(122, 165, 255, 0.08)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(portal.a.x, portal.a.y, portal.a.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (portal.b) {
      ctx.beginPath()
      ctx.arc(portal.b.x, portal.b.y, portal.b.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.globalAlpha = 0.35
      ctx.beginPath()
      ctx.moveTo(portal.a.x, portal.a.y)
      ctx.lineTo(portal.b.x, portal.b.y)
      ctx.stroke()
    }
    ctx.restore()
  })

  snapshot.pickups.forEach((pickup) => {
    const color = pickupColor(pickup.type)
    ctx.save()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pickup.x, pickup.y, pickup.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = '#09101d'
    ctx.font = '12px "Space Grotesk", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(pickupLabel(pickup.type), pickup.x, pickup.y + 0.5)
    ctx.restore()
  })

  ctx.fillStyle = COLORS.bullet
  snapshot.bullets.forEach((bullet) => {
    const radius = bullet.radius ?? 3
    if (typeof bullet.bouncesLeft === 'number') {
      const spin = (nowMs / 1000) * 6
      ctx.save()
      ctx.translate(bullet.x, bullet.y)
      ctx.rotate(spin)
      ctx.fillStyle = 'rgba(255, 206, 120, 0.9)'
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.55, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(160, 168, 176, 0.9)'
      ctx.lineWidth = Math.max(2, radius * 0.18)
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = 'rgba(130, 138, 146, 0.95)'
      const teeth = 10
      for (let i = 0; i < teeth; i += 1) {
        const angle = (i / teeth) * Math.PI * 2
        const inner = radius * 0.7
        const outer = radius * 1.05
        ctx.beginPath()
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
        ctx.lineTo(Math.cos(angle + 0.12) * outer, Math.sin(angle + 0.12) * outer)
        ctx.lineTo(Math.cos(angle + 0.24) * inner, Math.sin(angle + 0.24) * inner)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      return
    }
    ctx.beginPath()
    ctx.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2)
    ctx.fill()
  })

  beams.forEach((beam) => {
    if (beam.until <= nowMs) return
    ctx.save()
    ctx.strokeStyle = COLORS.beam
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(beam.from.x, beam.from.y)
    ctx.lineTo(beam.to.x, beam.to.y)
    ctx.stroke()
    ctx.restore()
  })

  novas.forEach((nova) => {
    if (nova.until <= nowMs) return
    const t = Math.max(0, Math.min(1, (nova.until - nowMs) / 120))
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 214, 140, 0.6)'
    ctx.lineWidth = 2
    ctx.globalAlpha = t
    ctx.beginPath()
    ctx.arc(nova.x, nova.y, 20 + (1 - t) * 30, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  })

  strikeMarks.forEach((mark) => {
    if (nowMs >= mark.explodeAt) return
    const total = mark.explodeAt - mark.startedAt
    const remaining = Math.max(0, mark.explodeAt - nowMs)
    const t = total > 0 ? remaining / total : 0
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 155, 107, 0.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(mark.x, mark.y, 18, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 155, 107, 0.5)'
    ctx.beginPath()
    ctx.arc(mark.x, mark.y, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t)
    ctx.stroke()
    ctx.restore()
  })

  strikeBooms.forEach((boom) => {
    if (boom.until <= nowMs) return
    const t = Math.max(0, Math.min(1, (boom.until - nowMs) / 200))
    ctx.save()
    ctx.globalAlpha = t
    ctx.fillStyle = 'rgba(255, 155, 107, 0.25)'
    ctx.beginPath()
    ctx.arc(boom.x, boom.y, boom.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })

  snapshot.players.forEach((player) => drawPlayer(ctx, player, fxMap.get(player.id), nowMs))

  if (strikePreview) {
    ctx.save()
    ctx.fillStyle = 'rgba(255, 155, 107, 0.08)'
    ctx.strokeStyle = 'rgba(255, 155, 107, 0.7)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(strikePreview.x, strikePreview.y, strikePreview.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(strikePreview.x - 12, strikePreview.y)
    ctx.lineTo(strikePreview.x + 12, strikePreview.y)
    ctx.moveTo(strikePreview.x, strikePreview.y - 12)
    ctx.lineTo(strikePreview.x, strikePreview.y + 12)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255, 155, 107, 0.9)'
    ctx.font = '12px "Space Grotesk", "Segoe UI", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('CLICK', strikePreview.x, strikePreview.y - strikePreview.r - 6)
    ctx.restore()
  }

  if (portalPreview) {
    ctx.save()
    ctx.strokeStyle = COLORS.portal
    ctx.fillStyle = 'rgba(122, 165, 255, 0.08)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(portalPreview.x, portalPreview.y, portalPreview.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(portalPreview.x - 10, portalPreview.y)
    ctx.lineTo(portalPreview.x + 10, portalPreview.y)
    ctx.moveTo(portalPreview.x, portalPreview.y - 10)
    ctx.lineTo(portalPreview.x, portalPreview.y + 10)
    ctx.stroke()
    ctx.restore()
  }
}
