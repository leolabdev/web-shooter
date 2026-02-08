import type { BulletState, GameEvent, PlayerState } from "../../shared/protocol";

const BULLET_RADIUS = 3;
const OUT_OF_BOUNDS_MARGIN = 12;

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
        const out =
            bullet.x < -OUT_OF_BOUNDS_MARGIN ||
            bullet.y < -OUT_OF_BOUNDS_MARGIN ||
            bullet.x > arena.w + OUT_OF_BOUNDS_MARGIN ||
            bullet.y > arena.h + OUT_OF_BOUNDS_MARGIN;
        if (bullet.ttlMs <= 0 || out) {
            removeIds.add(bullet.id);
        }
    }

    for (const bullet of bullets.values()) {
        if (removeIds.has(bullet.id)) continue;
        for (const player of players.values()) {
            if (!player.alive) continue;
            if (player.id === bullet.ownerRootId) continue;
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
            const hitRadius = player.r + BULLET_RADIUS;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                removeIds.add(bullet.id);
                player.hp = Math.max(0, player.hp - 1);
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
                break;
            }
        }
    }

    for (const id of removeIds) {
        bullets.delete(id);
    }
};
