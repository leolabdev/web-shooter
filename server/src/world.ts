import type { BulletState, GameEvent, PlayerState } from "../../shared/protocol";

const BULLET_RADIUS = 3;
const OUT_OF_BOUNDS_MARGIN = 12;
const BOUNCER_REHIT_MS = 120;
const SLASH_REFLECT_SPEED_MULT = 1.2;

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

        const radius = bullet.r ?? bullet.radius ?? BULLET_RADIUS;
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
        } else if (!bullet.isSlash) {
            const out =
                bullet.x < -OUT_OF_BOUNDS_MARGIN ||
                bullet.y < -OUT_OF_BOUNDS_MARGIN ||
                bullet.x > arena.w + OUT_OF_BOUNDS_MARGIN ||
                bullet.y > arena.h + OUT_OF_BOUNDS_MARGIN;
            if (out) {
                removeIds.add(bullet.id);
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

    const spawned: BulletState[] = [];
    const slashes = Array.from(bullets.values()).filter((bullet) => bullet.isSlash);
    for (const slash of slashes) {
        if (removeIds.has(slash.id)) continue;
        if ((slash.reflectsLeft ?? 0) <= 0) continue;
        const slashRadius = slash.r ?? slash.radius ?? BULLET_RADIUS;
        const slashLen = Math.hypot(slash.vx, slash.vy);
        if (slashLen < 0.001) continue;
        const sdx = slash.vx / slashLen;
        const sdy = slash.vy / slashLen;
        for (const bullet of bullets.values()) {
            if (removeIds.has(bullet.id)) continue;
            if (bullet.isSlash) continue;
            if (bullet.id === slash.id) continue;
            const bulletRadius = bullet.r ?? bullet.radius ?? BULLET_RADIUS;
            const dx = bullet.x - slash.x;
            const dy = bullet.y - slash.y;
            if (dx * dx + dy * dy > (slashRadius + bulletRadius) ** 2) continue;
            if ((slash.reflectsLeft ?? 0) <= 0) break;
            removeIds.add(bullet.id);
            slash.reflectsLeft = (slash.reflectsLeft ?? 0) - 1;
            const speed = Math.max(1, Math.hypot(bullet.vx, bullet.vy));
            spawned.push({
                id: `${bullet.id}-r-${nowMs}`,
                ownerId: slash.ownerId,
                ownerRootId: slash.ownerRootId,
                x: slash.x + sdx * (slashRadius + 4),
                y: slash.y + sdy * (slashRadius + 4),
                vx: sdx * speed * SLASH_REFLECT_SPEED_MULT,
                vy: sdy * speed * SLASH_REFLECT_SPEED_MULT,
                ttlMs: Math.max(120, bullet.ttlMs),
            });
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
                if (!bullet.isSlash) {
                    removeIds.add(bullet.id);
                    break;
                }
                continue;
            }
            const dx = bullet.x - player.x;
            const dy = bullet.y - player.y;
            const bulletRadius = bullet.r ?? bullet.radius ?? BULLET_RADIUS;
            const hitRadius = player.r + bulletRadius;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                if (
                    bullet.lastHitTargetId === player.id &&
                    bullet.lastHitAtMs !== undefined &&
                    nowMs - bullet.lastHitAtMs < BOUNCER_REHIT_MS
                ) {
                    continue;
                }
                if (!bullet.isSlash && typeof bullet.bouncesLeft !== "number") {
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
                if (!bullet.isSlash && typeof bullet.bouncesLeft !== "number") {
                    break;
                }
            }
        }
    }

    for (const bullet of spawned) {
        bullets.set(bullet.id, bullet);
    }

    for (const id of removeIds) {
        bullets.delete(id);
    }
};
