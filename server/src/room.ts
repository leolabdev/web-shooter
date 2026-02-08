import type { Server } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    PlayerState,
    BulletState,
    GameEvent,
    StateSnapshot,
} from "../../shared/protocol";
import { ARENA } from "../../shared/protocol";
import { stepBullets } from "./world";

export type RoomPlayer = {
    id: string;
    name: string;
};

type PlayerInput = {
    seq: number;
    dt: number;
    keys: { up: boolean; down: boolean; left: boolean; right: boolean };
    aim: { x: number; y: number };
    shoot: boolean;
    useEcho: boolean;
};

type BufferedInput = {
    tMs: number;
    keys: PlayerInput["keys"];
    aim: PlayerInput["aim"];
    shoot: boolean;
};

type EchoMeta = {
    expiresAtMs: number;
    ownerId: string;
};

const TICK_MS = 50;
const SPEED = 240;
const PLAYER_RADIUS = 18;
const PLAYER_HP = 3;
const ECHO_HP = 1;
const ECHO_DELAY_MS = 900;
const ECHO_LIFETIME_MS = 3500;
const ECHO_COOLDOWN_MS = 8000;
const BULLET_SPEED = 520;
const BULLET_TTL_MS = 1200;
const FIRE_COOLDOWN_MS = 1000 / 6;
const SPAWN_POINTS = [
    { x: 60, y: 60 },
    { x: ARENA.w - 60, y: 60 },
    { x: 60, y: ARENA.h - 60 },
    { x: ARENA.w - 60, y: ARENA.h - 60 },
] as const;

export class Room {
    readonly id: string;
    private io: Server<ClientToServerEvents, ServerToClientEvents>;
    private players = new Map<string, PlayerState>();
    private latestInputs = new Map<string, PlayerInput>();
    private inputBuffer = new Map<string, BufferedInput[]>();
    private bullets = new Map<string, BulletState>();
    private lastShotAtMs = new Map<string, number>();
    private echoReadyAtMs = new Map<string, number>();
    private echoes = new Map<string, EchoMeta>();
    private tickTimer: NodeJS.Timeout | null = null;
    private lastTickMs = Date.now();
    private bulletSeq = 0;
    private echoSeq = 0;

    constructor(
        id: string,
        io: Server<ClientToServerEvents, ServerToClientEvents>,
    ) {
        this.id = id;
        this.io = io;
        this.startTick();
    }

    addPlayer(player: RoomPlayer): void {
        const spawn = this.randomSpawn();
        this.players.set(player.id, {
            id: player.id,
            name: player.name,
            x: spawn.x,
            y: spawn.y,
            r: PLAYER_RADIUS,
            hp: PLAYER_HP,
            alive: true,
            kills: 0,
            deaths: 0,
            isEcho: false,
        });
        this.echoReadyAtMs.set(player.id, 0);
    }

    removePlayer(playerId: string): void {
        this.players.delete(playerId);
        this.latestInputs.delete(playerId);
        this.inputBuffer.delete(playerId);
        this.lastShotAtMs.delete(playerId);
        this.echoReadyAtMs.delete(playerId);
        for (const [echoId, meta] of this.echoes.entries()) {
            if (meta.ownerId === playerId) {
                this.echoes.delete(echoId);
                this.players.delete(echoId);
                this.lastShotAtMs.delete(echoId);
            }
        }
        for (const bullet of this.bullets.values()) {
            if (bullet.ownerRootId === playerId) {
                this.bullets.delete(bullet.id);
            }
        }
    }

    hasPlayer(playerId: string): boolean {
        return this.players.has(playerId);
    }

    isEmpty(): boolean {
        return this.players.size === 0;
    }

    getPlayerCount(): number {
        return this.players.size;
    }

    stop(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    }

    handleInput(playerId: string, input: PlayerInput): void {
        if (!this.players.has(playerId)) return;
        this.latestInputs.set(playerId, input);
    }

    private startTick(): void {
        this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    }

    private tick(): void {
        const now = Date.now();
        const dtSeconds = Math.max(0.001, (now - this.lastTickMs) / 1000);
        this.lastTickMs = now;
        const events: GameEvent[] = [];

        for (const [playerId, player] of this.players.entries()) {
            if (player.isEcho) continue;
            const input = this.latestInputs.get(playerId);
            if (!input || !player.alive) continue;
            this.bufferInput(playerId, input, now);
            const dx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
            const dy = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
            if (dx !== 0 || dy !== 0) {
                const length = Math.hypot(dx, dy) || 1;
                const nx = dx / length;
                const ny = dy / length;
                player.x += nx * SPEED * dtSeconds;
                player.y += ny * SPEED * dtSeconds;
                player.x = clamp(player.x, PLAYER_RADIUS, ARENA.w - PLAYER_RADIUS);
                player.y = clamp(player.y, PLAYER_RADIUS, ARENA.h - PLAYER_RADIUS);
            }

            if (input.shoot) {
                this.tryShoot(player, input, now, player.id);
            }

            if (input.useEcho) {
                this.trySpawnEcho(player, now, events);
            }
        }

        this.updateEchoes(now, dtSeconds);
        stepBullets({
            bullets: this.bullets,
            players: this.players,
            events,
            dtSeconds,
            arena: ARENA,
            onDeath: (playerId) => this.handleDeath(playerId),
        });

        this.updateEchoCooldowns(now);
        this.broadcastState(now, events);
    }

    private broadcastState(timestamp: number, events: GameEvent[]): void {
        const players = Array.from(this.players.values());
        const bullets = Array.from(this.bullets.values());
        for (const playerId of this.players.keys()) {
            const snapshot: StateSnapshot = {
                t: timestamp,
                roomId: this.id,
                you: { playerId },
                players,
                bullets,
                events,
            };
            this.io.to(playerId).emit("game:state", snapshot);
        }
    }

    private randomSpawn(): { x: number; y: number } {
        const index = Math.floor(Math.random() * SPAWN_POINTS.length);
        return SPAWN_POINTS[index];
    }

    private tryShoot(
        player: PlayerState,
        input: Pick<PlayerInput, "aim">,
        nowMs: number,
        ownerRootId: string,
    ): void {
        const lastShot = this.lastShotAtMs.get(player.id) ?? 0;
        if (nowMs - lastShot < FIRE_COOLDOWN_MS) return;

        const dx = input.aim.x - player.x;
        const dy = input.aim.y - player.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) return;

        const nx = dx / length;
        const ny = dy / length;
        const spawnOffset = player.r + 6;
        const bullet: BulletState = {
            id: `${this.id}-b-${this.bulletSeq++}`,
            ownerId: player.id,
            ownerRootId,
            x: player.x + nx * spawnOffset,
            y: player.y + ny * spawnOffset,
            vx: nx * BULLET_SPEED,
            vy: ny * BULLET_SPEED,
            ttlMs: BULLET_TTL_MS,
        };
        this.bullets.set(bullet.id, bullet);
        this.lastShotAtMs.set(player.id, nowMs);
    }

    private scheduleRespawn(playerId: string): void {
        setTimeout(() => {
            const player = this.players.get(playerId);
            if (!player) return;
            const spawn = this.randomSpawn();
            player.x = spawn.x;
            player.y = spawn.y;
            player.hp = PLAYER_HP;
            player.alive = true;
        }, 1500);
    }

    private bufferInput(playerId: string, input: PlayerInput, nowMs: number): void {
        const history = this.inputBuffer.get(playerId) ?? [];
        history.push({ tMs: nowMs, keys: input.keys, aim: input.aim, shoot: input.shoot });
        const cutoff = nowMs - 5000;
        while (history.length > 0 && history[0].tMs < cutoff) {
            history.shift();
        }
        this.inputBuffer.set(playerId, history);
    }

    private findBufferedInput(
        ownerId: string,
        targetMs: number,
    ): BufferedInput | null {
        const history = this.inputBuffer.get(ownerId);
        if (!history || history.length === 0) return null;
        for (let i = history.length - 1; i >= 0; i -= 1) {
            if (history[i].tMs <= targetMs) return history[i];
        }
        return null;
    }

    private updateEchoes(nowMs: number, dtSeconds: number): void {
        for (const [echoId, meta] of this.echoes.entries()) {
            const echo = this.players.get(echoId);
            if (!echo) {
                this.echoes.delete(echoId);
                continue;
            }
            if (nowMs >= meta.expiresAtMs) {
                this.echoes.delete(echoId);
                this.players.delete(echoId);
                this.lastShotAtMs.delete(echoId);
                continue;
            }
            const buffered = this.findBufferedInput(meta.ownerId, nowMs - ECHO_DELAY_MS);
            if (!buffered || !echo.alive) continue;
            this.applyMovement(echo, buffered, dtSeconds);
            if (buffered.shoot) {
                this.tryShoot(echo, buffered, nowMs, meta.ownerId);
            }
        }
    }

    private applyMovement(
        player: PlayerState,
        input: Pick<PlayerInput, "keys">,
        dtSeconds: number,
    ): void {
        const dx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
        const dy = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
        if (dx === 0 && dy === 0) return;
        const length = Math.hypot(dx, dy) || 1;
        const nx = dx / length;
        const ny = dy / length;
        player.x += nx * SPEED * dtSeconds;
        player.y += ny * SPEED * dtSeconds;
        player.x = clamp(player.x, PLAYER_RADIUS, ARENA.w - PLAYER_RADIUS);
        player.y = clamp(player.y, PLAYER_RADIUS, ARENA.h - PLAYER_RADIUS);
    }

    private trySpawnEcho(
        player: PlayerState,
        nowMs: number,
        events: GameEvent[],
    ): void {
        const readyAt = this.echoReadyAtMs.get(player.id) ?? 0;
        if (nowMs < readyAt) return;
        if (!player.alive) return;

        const echoId = `${this.id}-e-${this.echoSeq++}`;
        const spawn = { x: player.x + 8, y: player.y + 8 };
        this.players.set(echoId, {
            id: echoId,
            name: `${player.name} Echo`,
            x: spawn.x,
            y: spawn.y,
            r: PLAYER_RADIUS,
            hp: ECHO_HP,
            alive: true,
            kills: 0,
            deaths: 0,
            isEcho: true,
            ownerId: player.id,
        });
        this.echoes.set(echoId, {
            ownerId: player.id,
            expiresAtMs: nowMs + ECHO_LIFETIME_MS,
        });
        this.lastShotAtMs.set(echoId, 0);
        this.echoReadyAtMs.set(player.id, nowMs + ECHO_COOLDOWN_MS);
        events.push({ type: "spawn_echo", ownerId: player.id, echoId });
    }

    private updateEchoCooldowns(nowMs: number): void {
        for (const player of this.players.values()) {
            if (player.isEcho) {
                player.echoCdMs = undefined;
                continue;
            }
            const readyAt = this.echoReadyAtMs.get(player.id) ?? 0;
            player.echoCdMs = Math.max(0, readyAt - nowMs);
        }
    }

    private handleDeath(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        if (player.isEcho) {
            this.echoes.delete(playerId);
            this.players.delete(playerId);
            this.lastShotAtMs.delete(playerId);
            return;
        }
        this.scheduleRespawn(playerId);
    }
}

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));
