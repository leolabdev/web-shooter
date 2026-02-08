import type { Server } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    PlayerState,
    StateSnapshot,
} from "../../shared/protocol";
import { ARENA } from "../../shared/protocol";

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

const TICK_MS = 50;
const SPEED = 240;
const PLAYER_RADIUS = 18;
const PLAYER_HP = 3;
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
    private tickTimer: NodeJS.Timeout | null = null;
    private lastTickMs = Date.now();

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
    }

    removePlayer(playerId: string): void {
        this.players.delete(playerId);
        this.latestInputs.delete(playerId);
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
        for (const [playerId, player] of this.players.entries()) {
            const input = this.latestInputs.get(playerId);
            if (!input) continue;
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
        }
        this.broadcastState(now);
    }

    private broadcastState(timestamp: number): void {
        const players = Array.from(this.players.values());
        for (const playerId of this.players.keys()) {
            const snapshot: StateSnapshot = {
                t: timestamp,
                roomId: this.id,
                you: { playerId },
                players,
                bullets: [],
                events: [],
            };
            this.io.to(playerId).emit("game:state", snapshot);
        }
    }

    private randomSpawn(): { x: number; y: number } {
        const index = Math.floor(Math.random() * SPAWN_POINTS.length);
        return SPAWN_POINTS[index];
    }
}

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));
