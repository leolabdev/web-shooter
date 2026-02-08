import type { BulletState, GameEvent, PlayerState } from "../../shared/protocol";

const BULLET_RADIUS = 3;
const OUT_OF_BOUNDS_MARGIN = 12;
const BOUNCER_REHIT_MS = 120;

type StepParams = {
    bullets: Map<string, BulletState>;
    players: Map<string, PlayerState>;
    events: GameEvent[];
    dtSeconds: number;
    arena: { w: number; h: number };
    nowMs: number;
    onDeath: (playerId: string) => void;
    bulletSpeedMultiplier?: (x: number, y: number) => number;
    isInvulnerable?: (playerId: string) => boolean;
    allowDamage?: boolean;
    shieldHit?: (playerId: string, byRootId: string) => boolean;
    shouldIgnoreHit?: (bullet: BulletState, playerId: string, nowMs: number) => boolean;
};

export const stepBullets = ({
    bullets,
    players,
    events,
    dtSeconds,
    arena,
    nowMs,
    onDeath,
    bulletSpeedMultiplier,
    isInvulnerable,
    allowDamage = true,
    shieldHit,
    shouldIgnoreHit,
}: StepParams): void => {
    const removeIds = new Set<string>();

    if (!allowDamage) {
        for (const id of removeIds) {
            bullets.delete(id);
        }
        return;
    }

    for (const bullet of bullets.values()) {
        const speedMult = bulletSpeedMultiplier?.(bullet.x, bullet.y) ?? 1;
        bullet.x += bullet.vx * dtSeconds * speedMult;
        bullet.y += bullet.vy * dtSeconds * speedMult;
        bullet.ttlMs -= dtSeconds * 1000;

        const radius = bullet.radius ?? BULLET_RADIUS;
        if (typeof bullet.bouncesLeft === "number") {
            let bounced = false;
            if (bullet.x - radius < 0) {
                bullet.x = radius;
                bullet.vx = Math.abs(bullet.vx);
                bounced = true;
            } else if (bullet.x + radius > arena.w) {
                bullet.x = arena.w - radius;
                bullet.vx = -Math.abs(bullet.vx);
                bounced = true;
            }
            if (bullet.y - radius < 0) {
                bullet.y = radius;
                bullet.vy = Math.abs(bullet.vy);
                bounced = true;
            } else if (bullet.y + radius > arena.h) {
                bullet.y = arena.h - radius;
                bullet.vy = -Math.abs(bullet.vy);
                bounced = true;
            }
            if (bounced) {
                bullet.bouncesLeft -= 1;
                bullet.vx *= 2;
                bullet.vy *= 2;
                bullet.damage = (bullet.damage ?? 1) * 2;
                bullet.radius = radius * 0.8;
                if (bullet.bouncesLeft <= 0) {
                    removeIds.add(bullet.id);
                }
            }
        } else {
            const out =
                bullet.x < -OUT_OF_BOUNDS_MARGIN ||
                bullet.y < -OUT_OF_BOUNDS_MARGIN ||
                bullet.x > arena.w + OUT_OF_BOUNDS_MARGIN ||
                bullet.y > arena.h + OUT_OF_BOUNDS_MARGIN;
            if (out) {
                removeIds.add(bullet.id);
            }
        }
        if (bullet.ttlMs <= 0) {
            removeIds.add(bullet.id);
        }
    }

    for (const bullet of bullets.values()) {
        if (removeIds.has(bullet.id)) continue;
        for (const player of players.values()) {
            if (!player.alive) continue;
            if (typeof bullet.bouncesLeft !== "number" && player.id === bullet.ownerRootId) {
                continue;
            }
            if (isInvulnerable?.(player.id)) continue;
            if (shouldIgnoreHit?.(bullet, player.id, nowMs)) {
                removeIds.add(bullet.id);
                break;
            }
            if (shieldHit?.(player.id, bullet.ownerRootId)) {
                removeIds.add(bullet.id);
                break;
            }
            const dx = bullet.x - player.x;
            const dy = bullet.y - player.y;
            const bulletRadius = bullet.radius ?? BULLET_RADIUS;
            const hitRadius = player.r + bulletRadius;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                if (
                    bullet.lastHitTargetId === player.id &&
                    bullet.lastHitAtMs !== undefined &&
                    nowMs - bullet.lastHitAtMs < BOUNCER_REHIT_MS
                ) {
                    continue;
                }
                if (typeof bullet.bouncesLeft !== "number") {
                    removeIds.add(bullet.id);
                }
                const damage = bullet.damage ?? 1;
                player.hp = Math.max(0, player.hp - damage);
                bullet.lastHitTargetId = player.id;
                bullet.lastHitAtMs = nowMs;
                events.push({ type: "hit", targetId: player.id, byRootId: bullet.ownerRootId });
                if (player.hp === 0 && player.alive) {
                    player.alive = false;
                    player.deaths += 1;
                    const killer = players.get(bullet.ownerRootId);
                    if (killer) {
                        killer.kills += 1;
                    }
                    events.push({
                        type: "death",
                        id: player.id,
                        byRootId: bullet.ownerRootId,
                    });
                    onDeath(player.id);
                }
                if (typeof bullet.bouncesLeft !== "number") {
                    break;
                }
            }
        }
    }

    for (const id of removeIds) {
        bullets.delete(id);
    }
};
