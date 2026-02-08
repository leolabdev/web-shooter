import { ARENA, type PlayerState, type StateSnapshot } from '@shared/protocol'

const COLORS = {
  background: '#0a0f1c',
  border: '#4b6ef5',
  player: '#7ef1ff',
  playerStroke: '#09101d',
  bullet: '#ffd56b',
  text: '#e8f0ff',
}

const drawPlayer = (ctx: CanvasRenderingContext2D, player: PlayerState) => {
  ctx.save()
  ctx.globalAlpha = player.isEcho ? 0.35 : 1
  ctx.fillStyle = COLORS.player
  ctx.strokeStyle = COLORS.playerStroke
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.globalAlpha = player.isEcho ? 0.45 : 1
  ctx.fillStyle = COLORS.text
  ctx.font = '14px "Space Grotesk", "Segoe UI", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(player.name, player.x, player.y - player.r - 12)
  ctx.restore()
}

export const renderSnapshot = (ctx: CanvasRenderingContext2D, snapshot: StateSnapshot) => {
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

  snapshot.players.forEach((player) => drawPlayer(ctx, player))
}
