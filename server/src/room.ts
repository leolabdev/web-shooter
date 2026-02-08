import type { Server } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    AbilityType,
    PlayerState,
    BulletState,
    ChatMessage,
    GameEvent,
    MatchState,
    PortalState,
    PickupState,
    StateSnapshot,
    ZoneState,
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
    useItem: boolean;
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

type Strike = {
    id: string;
    x: number;
    y: number;
    explodeAtMs: number;
    r: number;
    damage: number;
    byId: string;
};

type PendingStrike = {
    active: boolean;
    expiresAtMs: number;
};

type PendingPortal = {
    portal: PortalState;
    expiresAtMs: number;
};

const TICK_MS = 50;
const SPEED = 240;
const PLAYER_RADIUS = 18;
const ECHO_HP = 1;
const ECHO_DELAY_MS = 900;
const ECHO_LIFETIME_MS = 3500;
const TIME_BUBBLE_RADIUS = 140;
const TIME_BUBBLE_LIFETIME_MS = 10000;
const PHASE_DASH_MS = 250;
const TIME_BUBBLE_MOVE_MULT = 0.55;
const TIME_BUBBLE_BULLET_MULT = 0.6;
const DASH_SPEED_MULT = 2.2;
const SHIELD_DURATION_MS = 5000;
const NOVA_BULLET_COUNT = 18;
const NOVA_BULLET_SPEED = 420;
const NOVA_BULLET_TTL_MS = 900;
const NOVA_SPAWN_OFFSET = 10;
const NOVA_HIT_COOLDOWN_MS = 150;
const STRIKE_MARK_MS = 1000;
const STRIKE_RADIUS = 120;
const STRIKE_DAMAGE = 2;
const STRIKE_TARGET_WINDOW_MS = 5000;
const PORTAL_RADIUS = 22;
const PORTAL_DURATION_MS = 10000;
const PORTAL_PENDING_MS = 5000;
const PORTAL_ENTITY_COOLDOWN_MS = 250;
const PORTAL_BULLET_COOLDOWN_MS = 60;
const PORTAL_BULLET_JUMPS = 2;
const BOUNCER_SPEED = 220;
const BOUNCER_TTL_MS = 12000;
const BOUNCER_RADIUS = 36;
const BOUNCER_DAMAGE = 1;
const BOUNCER_BOUNCES = 6;
const SLASH_SPEED = 480;
const SLASH_TTL_MS = 3000;
const SLICE_RADIUS = 48;
const SLASH_DAMAGE = 5;
const SLASH_REFLECTS = 20;
const BULLET_SPEED = 520;
const BULLET_TTL_MS = 1200;
const FIRE_COOLDOWN_MS = 1000 / 6;
const PICKUP_COUNT = 6;
const PICKUP_RADIUS = 12;
const PICKUP_PADDING = 40;
const PICKUP_RESPAWN_MS = 10000;
const RIFT_SNIPER_RESPAWN_MS = 45000;
const RIFT_SNIPER_MAX = 1;
const SPAWN_POINTS = [
    { x: 60, y: 60 },
    { x: ARENA.w - 60, y: 60 },
    { x: 60, y: ARENA.h - 60 },
    { x: ARENA.w - 60, y: ARENA.h - 60 },
] as const;

const ABILITIES: AbilityType[] = [
    "echo",
    "time_bubble",
    "phase_dash",
    "shield",
    "rift_sniper",
    "pulse_nova",
    "orbital_strike",
    "linked_portals",
    "annihilation_bouncer",
    "void_slice",
];

export class Room {
    readonly id: string;
    readonly maxPlayers: number;
    readonly isPrivate: boolean;
    readonly fillWithBots: boolean;
    readonly botCount: number;
    readonly botDifficulty: "easy" | "normal" | "hard";
    readonly maxHp: number;
    match: MatchState;
    private io: Server<ClientToServerEvents, ServerToClientEvents>;
    private players = new Map<string, PlayerState>();
    private latestInputs = new Map<string, PlayerInput>();
    private inputBuffer = new Map<string, BufferedInput[]>();
    private bullets = new Map<string, BulletState>();
    private lastShotAtMs = new Map<string, number>();
    private lastUseItemSeq = new Map<string, number>();
    private dashUntilMs = new Map<string, number>();
    private shieldUntilMs = new Map<string, number>();
    private novaHitCooldown = new Map<string, number>();
    private botIds: string[] = [];
    private botAi = new Map<
        string,
        {
            nextThinkAtMs: number;
            nextStrafeFlipAtMs: number;
            strafeDir: number;
            targetId?: string;
            aim: { x: number; y: number };
        }
    >();
    private echoes = new Map<string, EchoMeta>();
    private pickups = new Map<string, PickupState>();
    private zones = new Map<string, ZoneState>();
    private strikes: Strike[] = [];
    private pendingStrikes = new Map<string, PendingStrike>();
    private pendingEvents: GameEvent[] = [];
    private portals: PortalState[] = [];
    private pendingPortals = new Map<string, PendingPortal>();
    private portalCooldownUntilMs = new Map<string, number>();
    private chatMessages: ChatMessage[] = [];
    private tickTimer: NodeJS.Timeout | null = null;
    private lastTickMs = Date.now();
    private bulletSeq = 0;
    private echoSeq = 0;
    private pickupSeq = 0;
    private zoneSeq = 0;
    private novaSeq = 0;
    private strikeSeq = 0;
    private botSeq = 0;
    private lastBotCheckMs = 0;
    private portalSeq = 0;

    constructor(
        id: string,
        io: Server<ClientToServerEvents, ServerToClientEvents>,
        maxPlayers: number,
        isPrivate: boolean,
        fillWithBots: boolean,
        botCount: number,
        botDifficulty: "easy" | "normal" | "hard",
        maxHp: number,
        hostId: string,
    ) {
        this.id = id;
        this.io = io;
        this.maxPlayers = maxPlayers;
        this.isPrivate = isPrivate;
        this.fillWithBots = fillWithBots;
        this.botCount = botCount;
        this.botDifficulty = botDifficulty;
        this.maxHp = maxHp;
        this.match = {
            phase: "lobby",
            hostId,
            durationSec: 300,
        };
        this.spawnInitialPickups();
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
            hp: this.maxHp,
            maxHp: this.maxHp,
            alive: true,
            kills: 0,
            deaths: 0,
            isEcho: false,
            isBot: false,
            heldItem: null,
            shieldHp: 0,
        });
        if (!this.match.hostId) {
            this.match.hostId = player.id;
        }
    }

    private spawnBot(): void {
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
        const botId = `BOT-${this.id}-${this.botSeq++}-${suffix}`;
        const spawn = this.randomSpawn();
        this.players.set(botId, {
            id: botId,
            name: `Bot #${this.botSeq}`,
            x: spawn.x,
            y: spawn.y,
            r: PLAYER_RADIUS,
            hp: this.maxHp,
            maxHp: this.maxHp,
            alive: true,
            kills: 0,
            deaths: 0,
            isEcho: false,
            isBot: true,
            heldItem: null,
            shieldHp: 0,
        });
        this.botIds.push(botId);
        this.botAi.set(botId, {
            nextThinkAtMs: 0,
            nextStrafeFlipAtMs: 0,
            strafeDir: 1,
            aim: { x: spawn.x, y: spawn.y },
        });
    }

    removePlayer(playerId: string): void {
        this.players.delete(playerId);
        this.latestInputs.delete(playerId);
        this.inputBuffer.delete(playerId);
        this.lastShotAtMs.delete(playerId);
        this.lastUseItemSeq.delete(playerId);
        this.dashUntilMs.delete(playerId);
        this.shieldUntilMs.delete(playerId);
        this.botAi.delete(playerId);
        this.pendingStrikes.delete(playerId);
        this.strikes = this.strikes.filter((strike) => strike.byId !== playerId);
        this.pendingPortals.delete(playerId);
        this.portals = this.portals.filter((portal) => portal.ownerId !== playerId);
        this.clearPortalCooldowns(playerId);
        if (this.match.hostId === playerId) {
            this.assignNewHost();
        }
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

    private clearPortalCooldowns(entityId: string): void {
        const prefix = `${entityId}:`;
        for (const key of this.portalCooldownUntilMs.keys()) {
            if (key.startsWith(prefix)) {
                this.portalCooldownUntilMs.delete(key);
            }
        }
    }

    hasPlayer(playerId: string): boolean {
        return this.players.has(playerId);
    }

    isEmpty(): boolean {
        return this.getHumanCount() === 0;
    }

    getPlayerCount(): number {
        let count = 0;
        for (const player of this.players.values()) {
            if (!player.isEcho) count += 1;
        }
        return count;
    }

    getHumanCount(): number {
        let count = 0;
        for (const player of this.players.values()) {
            if (!player.isEcho && !player.isBot) count += 1;
        }
        return count;
    }

    getBotCount(): number {
        return this.botIds.length;
    }

    getPlayerName(playerId: string): string | null {
        return this.players.get(playerId)?.name ?? null;
    }

    getChatHistory(): ChatMessage[] {
        return this.chatMessages;
    }

    addChatMessage(message: ChatMessage): void {
        this.chatMessages.push(message);
        if (this.chatMessages.length > 50) {
            this.chatMessages = this.chatMessages.slice(-50);
        }
    }

    isFull(): boolean {
        return this.getPlayerCount() >= this.maxPlayers;
    }

    ensureBots(): void {
        if (!this.fillWithBots) return;
        if (this.getHumanCount() === 0) {
            this.clearBots();
            return;
        }
        const desiredBots = Math.min(
            this.botCount,
            Math.max(0, this.maxPlayers - this.getHumanCount()),
        );
        const delta = desiredBots - this.getBotCount();
        if (delta > 0) {
            for (let i = 0; i < delta; i += 1) {
                this.spawnBot();
            }
        } else if (delta < 0) {
            this.removeBotsForSpace(-delta);
        }
    }

    removeBotsForSpace(needed: number): void {
        for (let i = 0; i < needed; i += 1) {
            const botId = this.botIds.shift();
            if (!botId) return;
            this.players.delete(botId);
            this.latestInputs.delete(botId);
            this.inputBuffer.delete(botId);
            this.lastShotAtMs.delete(botId);
            this.lastUseItemSeq.delete(botId);
            this.dashUntilMs.delete(botId);
            this.shieldUntilMs.delete(botId);
            this.botAi.delete(botId);
        }
    }

    private clearBots(): void {
        this.removeBotsForSpace(this.botIds.length);
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
        const events: GameEvent[] = this.pendingEvents.splice(0);
        const isPlaying = this.match.phase === "playing";

        for (const [playerId, player] of this.players.entries()) {
            if (player.isEcho) continue;
            const input = this.latestInputs.get(playerId);
            if (!input || !player.alive) continue;
            if (player.isBot) continue;
            this.bufferInput(playerId, input, now);
            const moveMult = this.getMoveMultiplier(playerId, player, now);
            this.applyMovement(player, input, dtSeconds, moveMult);

            if (isPlaying && input.shoot) {
                this.tryShoot(player, input, now, player.id);
            }

            if (isPlaying && input.useItem && this.canUseItem(playerId, input.seq)) {
                this.activateAbility(player, now, input, events);
            }
        }

        this.updateBots(now, dtSeconds, isPlaying);
        this.updatePendingStrikes(now);
        this.updatePendingPortals(now);
        this.updateShields(now);

        this.collectPickups();
        this.updateZones(now);
        this.updateEchoes(now, dtSeconds, isPlaying);
        this.updatePortals(now);
        this.updatePortalEntities(now);
        this.updatePortalBullets(now);
        this.updateStrikes(now, events);
        stepBullets({
            bullets: this.bullets,
            players: this.players,
            events: isPlaying ? events : [],
            dtSeconds,
            arena: ARENA,
            nowMs: now,
            onDeath: (playerId) => this.handleDeath(playerId),
            bulletSpeedMultiplier: (x, y) => this.getBulletMultiplierAt(x, y),
            isInvulnerable: (playerId) => this.isDashing(playerId, now),
            shieldHit: (playerId, byRootId) =>
                this.handleShieldHit(playerId, byRootId, events),
            shouldIgnoreHit: (bullet, playerId, nowMs) =>
                this.shouldIgnoreNovaHit(bullet, playerId, nowMs),
            allowDamage: isPlaying,
        });

        if (this.match.phase === "playing" && this.match.endsAtMs && now >= this.match.endsAtMs) {
            this.match.phase = "ended";
            this.io.to(this.id).emit("match:toast", { message: "Match ended" });
        }

        if (this.fillWithBots && now - this.lastBotCheckMs > 1000) {
            this.lastBotCheckMs = now;
            this.ensureBots();
        }

        this.broadcastState(now, events);
    }

    private broadcastState(timestamp: number, events: GameEvent[]): void {
        const players = Array.from(this.players.values());
        const bullets = Array.from(this.bullets.values());
        const pickups = Array.from(this.pickups.values());
        const zones = Array.from(this.zones.values());
        const portals = this.portals;
        for (const playerId of this.players.keys()) {
            const snapshot: StateSnapshot = {
                t: timestamp,
                roomId: this.id,
                you: { playerId },
                players,
                bullets,
                events,
                pickups,
                zones,
                portals,
                match: this.match,
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
            portalJumpsLeft: PORTAL_BULLET_JUMPS,
            bulletPortalCooldownUntilMs: 0,
        };
        this.bullets.set(bullet.id, bullet);
        this.lastShotAtMs.set(player.id, nowMs);
    }

    private scheduleRespawn(playerId: string): void {
        setTimeout(() => {
            const player = this.players.get(playerId);
            if (!player) return;
            if (this.match.phase !== "playing") return;
            const spawn = this.randomSpawn();
            player.x = spawn.x;
            player.y = spawn.y;
            player.maxHp = this.maxHp;
            player.hp = this.maxHp;
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

    private updateEchoes(nowMs: number, dtSeconds: number, allowShoot: boolean): void {
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
            const moveMult = this.getMoveMultiplier(meta.ownerId, echo, nowMs, true);
            this.applyMovement(echo, buffered, dtSeconds, moveMult);
            if (allowShoot && buffered.shoot) {
                this.tryShoot(echo, buffered, nowMs, meta.ownerId);
            }
        }
    }

    private updateBots(nowMs: number, dtSeconds: number, allowShoot: boolean): void {
        if (!allowShoot) return;
        const config = this.getBotConfig();
        for (const botId of this.botIds) {
            const bot = this.players.get(botId);
            if (!bot || !bot.alive) continue;
            const target = this.findBotTarget(botId);
            if (!target) continue;
            const input = this.buildBotInput(botId, bot, target, nowMs, config);
            const moveMult = this.getMoveMultiplier(botId, bot, nowMs) * config.speedMult;
            this.applyMovement(bot, input, dtSeconds, moveMult);
            if (input.shoot) {
                this.tryShoot(bot, input, nowMs, bot.id);
            }
        }
    }

    private findBotTarget(botId: string): PlayerState | null {
        const humans = Array.from(this.players.values()).filter(
            (player) => !player.isEcho && !player.isBot && player.alive,
        );
        const pool =
            humans.length > 0
                ? humans
                : Array.from(this.players.values()).filter(
                      (player) => player.id !== botId && player.alive,
                  );
        if (pool.length === 0) return null;
        const bot = this.players.get(botId);
        if (!bot) return null;
        let best = pool[0];
        let bestDist = distanceSq(bot.x, bot.y, best.x, best.y);
        for (let i = 1; i < pool.length; i += 1) {
            const candidate = pool[i];
            const dist = distanceSq(bot.x, bot.y, candidate.x, candidate.y);
            if (dist < bestDist) {
                best = candidate;
                bestDist = dist;
            }
        }
        return best;
    }

    private buildBotInput(
        botId: string,
        bot: PlayerState,
        target: PlayerState,
        nowMs: number,
        config: { aimJitter: number; reactionMs: number; shootRange: number; speedMult: number },
    ): PlayerInput {
        const dx = target.x - bot.x;
        const dy = target.y - bot.y;
        const dist = Math.hypot(dx, dy) || 1;
        let moveX = 0;
        let moveY = 0;
        if (dist > 280) {
            moveX = dx / dist;
            moveY = dy / dist;
        } else if (dist < 180) {
            moveX = -dx / dist;
            moveY = -dy / dist;
        } else {
            const ai = this.botAi.get(botId);
            if (ai && nowMs > ai.nextStrafeFlipAtMs) {
                ai.strafeDir *= -1;
                ai.nextStrafeFlipAtMs = nowMs + 700;
            }
            const dir = this.botAi.get(botId)?.strafeDir ?? 1;
            moveX = (-dy / dist) * dir;
            moveY = (dx / dist) * dir;
        }

        const ai = this.botAi.get(botId) ?? {
            nextThinkAtMs: 0,
            nextStrafeFlipAtMs: 0,
            strafeDir: 1,
            aim: { x: target.x, y: target.y },
        };

        if (nowMs >= ai.nextThinkAtMs || ai.targetId !== target.id) {
            ai.targetId = target.id;
            ai.nextThinkAtMs = nowMs + config.reactionMs;
            ai.aim = {
                x: target.x + (Math.random() - 0.5) * config.aimJitter * 2,
                y: target.y + (Math.random() - 0.5) * config.aimJitter * 2,
            };
        }
        this.botAi.set(botId, ai);

        const keys = {
            up: moveY < -0.2,
            down: moveY > 0.2,
            left: moveX < -0.2,
            right: moveX > 0.2,
        };
        const aim = ai.aim;
        const shoot = dist < config.shootRange && target.alive;

        return {
            seq: nowMs,
            dt: 50,
            keys,
            aim,
            shoot,
            useItem: false,
        };
    }

    private getBotConfig(): {
        aimJitter: number;
        reactionMs: number;
        shootRange: number;
        speedMult: number;
    } {
        if (this.botDifficulty === "easy") {
            return { aimJitter: 60, reactionMs: 300, shootRange: 450, speedMult: 0.75 };
        }
        if (this.botDifficulty === "hard") {
            return { aimJitter: 10, reactionMs: 100, shootRange: 750, speedMult: 1.05 };
        }
        return { aimJitter: 28, reactionMs: 180, shootRange: 650, speedMult: 0.95 };
    }

    private canUseItem(playerId: string, seq: number): boolean {
        const lastSeq = this.lastUseItemSeq.get(playerId);
        if (lastSeq === seq) return false;
        this.lastUseItemSeq.set(playerId, seq);
        return true;
    }

    private activateAbility(
        player: PlayerState,
        nowMs: number,
        input: PlayerInput,
        events: GameEvent[],
    ): void {
        if (!player.heldItem) return;
        if (!player.alive) return;
        if (player.heldItem === "echo") {
            this.trySpawnEcho(player, nowMs, events);
        } else if (player.heldItem === "time_bubble") {
            this.spawnTimeBubble(player, nowMs);
        } else if (player.heldItem === "phase_dash") {
            this.dashUntilMs.set(player.id, nowMs + PHASE_DASH_MS);
        } else if (player.heldItem === "shield") {
            this.activateShield(player, nowMs);
        } else if (player.heldItem === "rift_sniper") {
            const fired = this.fireRiftSniper(player, input, nowMs, events);
            if (!fired) {
                return;
            }
        } else if (player.heldItem === "pulse_nova") {
            this.firePulseNova(player, nowMs, events);
        } else if (player.heldItem === "orbital_strike") {
            this.beginStrikeTargeting(player, nowMs);
            return;
        } else if (player.heldItem === "linked_portals") {
            this.beginPortalPlacement(player, nowMs);
            return;
        } else if (player.heldItem === "annihilation_bouncer") {
            const fired = this.fireAnnihilationBouncer(player, input);
            if (!fired) {
                return;
            }
        } else if (player.heldItem === "void_slice") {
            const fired = this.fireVoidSlice(player, input);
            if (!fired) {
                return;
            }
        }
        player.heldItem = null;
    }

    private fireAnnihilationBouncer(player: PlayerState, input: PlayerInput): boolean {
        if (player.isEcho) return false;
        const dx = input.aim.x - player.x;
        const dy = input.aim.y - player.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) return false;
        const nx = dx / length;
        const ny = dy / length;
        const spawnOffset = player.r + BOUNCER_RADIUS + 4;
        const bullet: BulletState = {
            id: `${this.id}-b-${this.bulletSeq++}`,
            ownerId: player.id,
            ownerRootId: player.id,
            x: player.x + nx * spawnOffset,
            y: player.y + ny * spawnOffset,
            vx: nx * BOUNCER_SPEED,
            vy: ny * BOUNCER_SPEED,
            ttlMs: BOUNCER_TTL_MS,
            bouncesLeft: BOUNCER_BOUNCES,
            damage: BOUNCER_DAMAGE,
            radius: BOUNCER_RADIUS,
        };
        this.bullets.set(bullet.id, bullet);
        return true;
    }

    private fireVoidSlice(player: PlayerState, input: PlayerInput): boolean {
        if (player.isEcho) return false;
        const dx = input.aim.x - player.x;
        const dy = input.aim.y - player.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) return false;
        const nx = dx / length;
        const ny = dy / length;
        const spawnOffset = player.r + 8;
        const bullet: BulletState = {
            id: `${this.id}-s-${this.bulletSeq++}`,
            ownerId: player.id,
            ownerRootId: player.id,
            x: player.x + nx * spawnOffset,
            y: player.y + ny * spawnOffset,
            vx: nx * SLASH_SPEED,
            vy: ny * SLASH_SPEED,
            ttlMs: SLASH_TTL_MS,
            isSlash: true,
            damage: SLASH_DAMAGE,
            r: SLICE_RADIUS,
            reflectsLeft: SLASH_REFLECTS,
            portalJumpsLeft: PORTAL_BULLET_JUMPS,
            portalCooldownUntilMs: 0,
        };
        this.bullets.set(bullet.id, bullet);
        return true;
    }

    private beginStrikeTargeting(player: PlayerState, nowMs: number): void {
        if (player.isEcho) return;
        const pending = this.pendingStrikes.get(player.id);
        if (pending && pending.active && nowMs <= pending.expiresAtMs) return;
        this.pendingStrikes.set(player.id, {
            active: true,
            expiresAtMs: nowMs + STRIKE_TARGET_WINDOW_MS,
        });
        this.io.to(player.id).emit("match:toast", { message: "Select target (LMB)" });
    }

    private beginPortalPlacement(player: PlayerState, nowMs: number): void {
        if (player.isEcho) return;
        if (this.pendingPortals.has(player.id)) return;
        const portal: PortalState = {
            id: `${this.id}-p-${this.portalSeq++}`,
            ownerId: player.id,
            a: { x: player.x, y: player.y, r: PORTAL_RADIUS },
            createdAtMs: nowMs,
        };
        this.pendingPortals.set(player.id, {
            portal,
            expiresAtMs: nowMs + PORTAL_PENDING_MS,
        });
        this.io.to(player.id).emit("match:toast", { message: "Place portal B (LMB)" });
    }

    confirmPortalB(playerId: string, x: number, y: number, nowMs: number): void {
        if (this.match.phase !== "playing") return;
        const player = this.players.get(playerId);
        if (!player || player.isEcho || !player.alive) return;
        const pending = this.pendingPortals.get(playerId);
        if (!pending || nowMs > pending.expiresAtMs) {
            this.pendingPortals.delete(playerId);
            return;
        }
        if (player.heldItem !== "linked_portals") return;
        const target = {
            x: clamp(x, 0, ARENA.w),
            y: clamp(y, 0, ARENA.h),
        };
        pending.portal.b = { x: target.x, y: target.y, r: PORTAL_RADIUS };
        pending.portal.expiresAtMs = nowMs + PORTAL_DURATION_MS;
        this.portals.push(pending.portal);
        this.pendingPortals.delete(playerId);
        player.heldItem = null;
    }

    private activateShield(player: PlayerState, nowMs: number): void {
        if (player.isEcho) return;
        player.shieldHp = 2;
        this.shieldUntilMs.set(player.id, nowMs + SHIELD_DURATION_MS);
    }

    private fireRiftSniper(
        player: PlayerState,
        input: PlayerInput,
        nowMs: number,
        events: GameEvent[],
    ): boolean {
        if (player.isEcho) return false;
        const dx = input.aim.x - player.x;
        const dy = input.aim.y - player.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.001) return false;
        const nx = dx / length;
        const ny = dy / length;
        const end = this.rayToArenaEdge(player.x, player.y, nx, ny);
        events.push({ type: "beam_fire", byId: player.id, from: { x: player.x, y: player.y }, to: end });

        for (const target of this.players.values()) {
            if (!target.alive) continue;
            if (target.id === player.id) continue;
            if (target.isEcho && target.ownerId === player.id) continue;
            if (!this.segmentIntersectsCircle(
                player.x,
                player.y,
                end.x,
                end.y,
                target.x,
                target.y,
                target.r,
            )) {
                continue;
            }
            if (!target.isEcho && this.isShieldActive(target.id, nowMs)) {
                this.breakShield(target.id, events);
                continue;
            }
            this.killEntity(target, player.id, events);
        }
        return true;
    }

    private firePulseNova(player: PlayerState, nowMs: number, events: GameEvent[]): void {
        if (player.isEcho) return;
        const burstId = `${this.id}-n-${this.novaSeq++}`;
        const spawnRadius = player.r + NOVA_SPAWN_OFFSET;
        for (let i = 0; i < NOVA_BULLET_COUNT; i += 1) {
            const angle = (i / NOVA_BULLET_COUNT) * Math.PI * 2;
            const nx = Math.cos(angle);
            const ny = Math.sin(angle);
            const bullet: BulletState = {
                id: `${this.id}-b-${this.bulletSeq++}`,
                ownerId: player.id,
                ownerRootId: player.id,
                x: player.x + nx * spawnRadius,
                y: player.y + ny * spawnRadius,
                vx: nx * NOVA_BULLET_SPEED,
                vy: ny * NOVA_BULLET_SPEED,
                ttlMs: NOVA_BULLET_TTL_MS,
                burstId,
                portalJumpsLeft: PORTAL_BULLET_JUMPS,
                bulletPortalCooldownUntilMs: 0,
            };
            this.bullets.set(bullet.id, bullet);
        }
        events.push({ type: "nova_fire", byId: player.id });
    }

    private spawnTimeBubble(player: PlayerState, nowMs: number): void {
        const zone: ZoneState = {
            id: `${this.id}-z-${this.zoneSeq++}`,
            kind: "time_bubble",
            x: player.x,
            y: player.y,
            r: TIME_BUBBLE_RADIUS,
            expiresAtMs: nowMs + TIME_BUBBLE_LIFETIME_MS,
        };
        this.zones.set(zone.id, zone);
    }

    private updateZones(nowMs: number): void {
        for (const [zoneId, zone] of this.zones.entries()) {
            if (zone.expiresAtMs <= nowMs) {
                this.zones.delete(zoneId);
            }
        }
    }

    private updatePendingStrikes(nowMs: number): void {
        for (const [playerId, pending] of this.pendingStrikes.entries()) {
            if (!pending.active || nowMs > pending.expiresAtMs) {
                this.pendingStrikes.delete(playerId);
            }
        }
    }

    private updatePendingPortals(nowMs: number): void {
        for (const [playerId, pending] of this.pendingPortals.entries()) {
            if (nowMs > pending.expiresAtMs) {
                this.pendingPortals.delete(playerId);
            }
        }
    }

    private updateShields(nowMs: number): void {
        for (const player of this.players.values()) {
            if (player.isEcho) {
                player.shieldHp = undefined;
                continue;
            }
            if (!this.isShieldActive(player.id, nowMs)) {
                player.shieldHp = 0;
            }
        }
    }

    private updateStrikes(nowMs: number, events: GameEvent[]): void {
        if (this.match.phase !== "playing") return;
        const pending: Strike[] = [];
        for (const strike of this.strikes) {
            if (nowMs >= strike.explodeAtMs) {
                this.resolveStrike(strike, nowMs, events);
            } else {
                pending.push(strike);
            }
        }
        this.strikes = pending;
    }

    private updatePortals(nowMs: number): void {
        this.portals = this.portals.filter(
            (portal) => !portal.expiresAtMs || nowMs < portal.expiresAtMs,
        );
    }

    private updatePortalEntities(nowMs: number): void {
        for (const portal of this.portals) {
            if (!portal.b) continue;
            const a = portal.a;
            const b = portal.b;
            for (const entity of this.players.values()) {
                if (!entity.alive) continue;
                const cooldownKey = `${entity.id}:${portal.id}`;
                const cooldown = this.portalCooldownUntilMs.get(cooldownKey) ?? 0;
                if (nowMs < cooldown) continue;
                if (isInsideCircle(entity.x, entity.y, a.x, a.y, a.r + entity.r)) {
                    entity.x = b.x;
                    entity.y = b.y;
                    this.portalCooldownUntilMs.set(
                        cooldownKey,
                        nowMs + PORTAL_ENTITY_COOLDOWN_MS,
                    );
                } else if (isInsideCircle(entity.x, entity.y, b.x, b.y, b.r + entity.r)) {
                    entity.x = a.x;
                    entity.y = a.y;
                    this.portalCooldownUntilMs.set(
                        cooldownKey,
                        nowMs + PORTAL_ENTITY_COOLDOWN_MS,
                    );
                }
            }
        }
    }

    private updatePortalBullets(nowMs: number): void {
        for (const portal of this.portals) {
            if (!portal.b) continue;
            const a = portal.a;
            const b = portal.b;
            for (const bullet of this.bullets.values()) {
                const jumpsLeft = bullet.portalJumpsLeft ?? PORTAL_BULLET_JUMPS;
                if (jumpsLeft <= 0) continue;
                const cooldown = bullet.isSlash
                    ? bullet.portalCooldownUntilMs ?? 0
                    : bullet.bulletPortalCooldownUntilMs ?? 0;
                if (nowMs < cooldown) continue;
                if (isInsideCircle(bullet.x, bullet.y, a.x, a.y, a.r)) {
                    this.teleportBullet(bullet, b);
                    bullet.portalJumpsLeft = jumpsLeft - 1;
                    if (bullet.isSlash) {
                        bullet.portalCooldownUntilMs = nowMs + PORTAL_BULLET_COOLDOWN_MS;
                    } else {
                        bullet.bulletPortalCooldownUntilMs = nowMs + PORTAL_BULLET_COOLDOWN_MS;
                    }
                } else if (isInsideCircle(bullet.x, bullet.y, b.x, b.y, b.r)) {
                    this.teleportBullet(bullet, a);
                    bullet.portalJumpsLeft = jumpsLeft - 1;
                    if (bullet.isSlash) {
                        bullet.portalCooldownUntilMs = nowMs + PORTAL_BULLET_COOLDOWN_MS;
                    } else {
                        bullet.bulletPortalCooldownUntilMs = nowMs + PORTAL_BULLET_COOLDOWN_MS;
                    }
                }
            }
        }
    }

    private teleportBullet(bullet: BulletState, portal: { x: number; y: number; r: number }): void {
        const len = Math.hypot(bullet.vx, bullet.vy) || 1;
        const nx = bullet.vx / len;
        const ny = bullet.vy / len;
        const offset = portal.r + 6;
        bullet.x = portal.x + nx * offset;
        bullet.y = portal.y + ny * offset;
        bullet.vx = -bullet.vx;
        bullet.vy = -bullet.vy;
    }

    private getMoveMultiplier(
        playerId: string,
        player: PlayerState,
        nowMs: number,
        isEcho = false,
    ): number {
        const zoneMult = this.getTimeBubbleMoveMultAt(player.x, player.y);
        if (isEcho) return zoneMult;
        return zoneMult * (this.isDashing(playerId, nowMs) ? DASH_SPEED_MULT : 1);
    }

    private isDashing(playerId: string, nowMs: number): boolean {
        const until = this.dashUntilMs.get(playerId) ?? 0;
        return nowMs < until;
    }

    private getTimeBubbleMoveMultAt(x: number, y: number): number {
        for (const zone of this.zones.values()) {
            if (zone.kind !== "time_bubble") continue;
            const dx = x - zone.x;
            const dy = y - zone.y;
            if (dx * dx + dy * dy <= zone.r * zone.r) {
                return TIME_BUBBLE_MOVE_MULT;
            }
        }
        return 1;
    }

    private getBulletMultiplierAt(x: number, y: number): number {
        for (const zone of this.zones.values()) {
            if (zone.kind !== "time_bubble") continue;
            const dx = x - zone.x;
            const dy = y - zone.y;
            if (dx * dx + dy * dy <= zone.r * zone.r) {
                return TIME_BUBBLE_BULLET_MULT;
            }
        }
        return 1;
    }

    private collectPickups(): void {
        for (const player of this.players.values()) {
            if (player.isEcho || !player.alive) continue;
            if (player.heldItem) continue;
            for (const pickup of this.pickups.values()) {
                const dx = player.x - pickup.x;
                const dy = player.y - pickup.y;
                const hitRadius = player.r + pickup.r;
                if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                    if (pickup.type === "shield" || pickup.type === "rift_sniper") {
                        if (player.isEcho) continue;
                    }
                    player.heldItem = pickup.type;
                    this.pickups.delete(pickup.id);
                    this.schedulePickupRespawn(pickup.type);
                    break;
                }
            }
        }
    }

    private schedulePickupRespawn(type: AbilityType): void {
        setTimeout(() => {
            if (this.pickups.size < PICKUP_COUNT) {
                this.spawnPickup();
            }
        }, type === "rift_sniper" ? RIFT_SNIPER_RESPAWN_MS : PICKUP_RESPAWN_MS);
    }

    private spawnInitialPickups(): void {
        for (let i = 0; i < PICKUP_COUNT; i += 1) {
            this.spawnPickup();
        }
    }

    private spawnPickup(): void {
        let type = ABILITIES[Math.floor(Math.random() * ABILITIES.length)];
        if (type === "rift_sniper" && this.countPickups("rift_sniper") >= RIFT_SNIPER_MAX) {
            type = "shield";
        }
        const { x, y } = this.randomPickupPosition();
        const pickup: PickupState = {
            id: `${this.id}-p-${this.pickupSeq++}`,
            type,
            x,
            y,
            r: PICKUP_RADIUS,
        };
        this.pickups.set(pickup.id, pickup);
    }

    private countPickups(type: AbilityType): number {
        let count = 0;
        for (const pickup of this.pickups.values()) {
            if (pickup.type === type) count += 1;
        }
        return count;
    }

    private randomPickupPosition(): { x: number; y: number } {
        const x =
            PICKUP_PADDING +
            Math.random() * (ARENA.w - PICKUP_PADDING * 2);
        const y =
            PICKUP_PADDING +
            Math.random() * (ARENA.h - PICKUP_PADDING * 2);
        return { x, y };
    }

    private applyMovement(
        player: PlayerState,
        input: Pick<PlayerInput, "keys">,
        dtSeconds: number,
        speedMultiplier: number,
    ): void {
        const dx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
        const dy = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
        if (dx === 0 && dy === 0) return;
        const length = Math.hypot(dx, dy) || 1;
        const nx = dx / length;
        const ny = dy / length;
        player.x += nx * SPEED * dtSeconds * speedMultiplier;
        player.y += ny * SPEED * dtSeconds * speedMultiplier;
        player.x = clamp(player.x, PLAYER_RADIUS, ARENA.w - PLAYER_RADIUS);
        player.y = clamp(player.y, PLAYER_RADIUS, ARENA.h - PLAYER_RADIUS);
    }

    private trySpawnEcho(
        player: PlayerState,
        nowMs: number,
        events: GameEvent[],
    ): void {
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
            maxHp: ECHO_HP,
            alive: true,
            kills: 0,
            deaths: 0,
            isEcho: true,
            ownerId: player.id,
            heldItem: null,
            shieldHp: 0,
        });
        this.echoes.set(echoId, {
            ownerId: player.id,
            expiresAtMs: nowMs + ECHO_LIFETIME_MS,
        });
        this.lastShotAtMs.set(echoId, 0);
        events.push({ type: "spawn_echo", ownerId: player.id, echoId });
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
        player.shieldHp = 0;
        this.shieldUntilMs.delete(playerId);
        if (this.match.phase === "playing") {
            this.scheduleRespawn(playerId);
        }
    }

    private isShieldActive(playerId: string, nowMs: number): boolean {
        const until = this.shieldUntilMs.get(playerId) ?? 0;
        const player = this.players.get(playerId);
        return !!player && !player.isEcho && (player.shieldHp ?? 0) > 0 && nowMs < until;
    }

    private breakShield(playerId: string, events: GameEvent[]): void {
        const player = this.players.get(playerId);
        if (!player || player.isEcho) return;
        player.shieldHp = 0;
        this.shieldUntilMs.delete(playerId);
        events.push({ type: "shield_break", id: playerId });
    }

    private handleShieldHit(playerId: string, byRootId: string, events: GameEvent[]): boolean {
        const now = Date.now();
        if (!this.isShieldActive(playerId, now)) return false;
        const player = this.players.get(playerId);
        if (!player || player.isEcho) return false;
        const nextHp = Math.max(0, (player.shieldHp ?? 0) - 1);
        player.shieldHp = nextHp;
        events.push({ type: "shield_hit", id: playerId, hpLeft: nextHp });
        if (nextHp === 0) {
            this.breakShield(playerId, events);
        }
        return true;
    }

    private shouldIgnoreNovaHit(
        bullet: BulletState,
        playerId: string,
        nowMs: number,
    ): boolean {
        if (!bullet.burstId) return false;
        const key = `${bullet.burstId}:${playerId}`;
        const lastHit = this.novaHitCooldown.get(key) ?? 0;
        if (nowMs - lastHit < NOVA_HIT_COOLDOWN_MS) {
            return true;
        }
        this.novaHitCooldown.set(key, nowMs);
        this.gcNovaCooldowns(nowMs);
        return false;
    }

    private gcNovaCooldowns(nowMs: number): void {
        const cutoff = nowMs - 1000;
        for (const [key, value] of this.novaHitCooldown.entries()) {
            if (value < cutoff) {
                this.novaHitCooldown.delete(key);
            }
        }
    }

    private killEntity(target: PlayerState, byRootId: string, events: GameEvent[]): void {
        if (!target.alive) return;
        target.alive = false;
        target.deaths += 1;
        const killer = this.players.get(byRootId);
        if (killer) {
            killer.kills += 1;
        }
        events.push({ type: "death", id: target.id, byRootId });
        this.handleDeath(target.id);
    }

    confirmStrike(playerId: string, x: number, y: number, nowMs: number): void {
        if (this.match.phase !== "playing") return;
        const player = this.players.get(playerId);
        if (!player || player.isEcho || !player.alive) return;
        const pending = this.pendingStrikes.get(playerId);
        if (!pending || !pending.active || nowMs > pending.expiresAtMs) return;
        if (player.heldItem !== "orbital_strike") return;

        const target = {
            x: clamp(x, 0, ARENA.w),
            y: clamp(y, 0, ARENA.h),
        };
        const strike: Strike = {
            id: `${this.id}-s-${this.strikeSeq++}`,
            x: target.x,
            y: target.y,
            explodeAtMs: nowMs + STRIKE_MARK_MS,
            r: STRIKE_RADIUS,
            damage: STRIKE_DAMAGE,
            byId: playerId,
        };
        this.strikes.push(strike);
        this.pendingStrikes.delete(playerId);
        player.heldItem = null;
        this.pendingEvents.push({
            type: "strike_mark",
            id: strike.id,
            x: strike.x,
            y: strike.y,
            etaMs: STRIKE_MARK_MS,
        });
    }

    private resolveStrike(strike: Strike, nowMs: number, events: GameEvent[]): void {
        for (const target of this.players.values()) {
            if (!target.alive) continue;
            if (
                !this.pointInCircle(
                    target.x,
                    target.y,
                    strike.x,
                    strike.y,
                    strike.r,
                )
            ) {
                continue;
            }
            if (!target.isEcho && this.isShieldActive(target.id, nowMs)) {
                this.handleShieldHit(target.id, strike.byId, events);
                continue;
            }
            if (target.isEcho && target.ownerId === strike.byId) continue;
            const nextHp = target.hp - strike.damage;
            if (nextHp <= 0) {
                this.killEntity(target, strike.byId, events);
            } else {
                target.hp = nextHp;
                events.push({ type: "hit", targetId: target.id, byRootId: strike.byId });
            }
        }
        events.push({
            type: "strike_boom",
            id: strike.id,
            x: strike.x,
            y: strike.y,
            r: strike.r,
        });
    }

    private pointInCircle(
        x: number,
        y: number,
        cx: number,
        cy: number,
        r: number,
    ): boolean {
        const dx = x - cx;
        const dy = y - cy;
        return dx * dx + dy * dy <= r * r;
    }

    private rayToArenaEdge(
        x: number,
        y: number,
        nx: number,
        ny: number,
    ): { x: number; y: number } {
        const tVals: number[] = [];
        if (nx !== 0) {
            tVals.push((0 - x) / nx);
            tVals.push((ARENA.w - x) / nx);
        }
        if (ny !== 0) {
            tVals.push((0 - y) / ny);
            tVals.push((ARENA.h - y) / ny);
        }
        const positives = tVals.filter((value) => value > 0);
        const t = positives.length > 0 ? Math.min(...positives) : 0;
        return { x: x + nx * t, y: y + ny * t };
    }

    private segmentIntersectsCircle(
        ax: number,
        ay: number,
        bx: number,
        by: number,
        cx: number,
        cy: number,
        r: number,
    ): boolean {
        const abx = bx - ax;
        const aby = by - ay;
        const t =
            ((cx - ax) * abx + (cy - ay) * aby) / (abx * abx + aby * aby || 1);
        const clamped = Math.max(0, Math.min(1, t));
        const px = ax + abx * clamped;
        const py = ay + aby * clamped;
        const dx = cx - px;
        const dy = cy - py;
        return dx * dx + dy * dy <= r * r;
    }

    private assignNewHost(): void {
        const nextHost = Array.from(this.players.values()).find((player) => !player.isEcho);
        if (!nextHost) {
            this.match.hostId = "";
            return;
        }
        this.match.hostId = nextHost.id;
        this.io.to(this.id).emit("match:toast", { message: `New host: ${nextHost.name}` });
    }

    configureMatchDuration(durationSec: number): void {
        const clamped = Math.min(900, Math.max(60, Math.floor(durationSec || 300)));
        this.match.durationSec = clamped;
    }

    startMatch(nowMs: number): void {
        this.resetForMatch(true);
        this.match.phase = "playing";
        this.match.startedAtMs = nowMs;
        this.match.endsAtMs = nowMs + this.match.durationSec * 1000;
        this.io.to(this.id).emit("match:toast", { message: "Match started" });
    }

    restartMatch(): void {
        this.match.phase = "lobby";
        this.match.startedAtMs = undefined;
        this.match.endsAtMs = undefined;
        this.resetForMatch(true);
        this.io.to(this.id).emit("match:toast", { message: "Returned to lobby" });
    }

    private resetForMatch(clearScores = false): void {
        this.bullets.clear();
        this.zones.clear();
        this.strikes = [];
        this.pendingStrikes.clear();
        this.pendingEvents = [];
        this.portals = [];
        this.pendingPortals.clear();
        this.portalCooldownUntilMs.clear();
        this.botAi.clear();
        for (const [echoId, meta] of this.echoes.entries()) {
            this.echoes.delete(echoId);
            this.players.delete(echoId);
            this.lastShotAtMs.delete(echoId);
        }
        for (const player of this.players.values()) {
            if (player.isEcho) continue;
            const spawn = this.randomSpawn();
            player.x = spawn.x;
            player.y = spawn.y;
            player.maxHp = this.maxHp;
            player.hp = this.maxHp;
            player.alive = true;
            player.heldItem = null;
            player.shieldHp = 0;
            this.shieldUntilMs.delete(player.id);
            if (clearScores) {
                player.kills = 0;
                player.deaths = 0;
            }
        }
    }
}

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

const distanceSq = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
};

const isInsideCircle = (
    x: number,
    y: number,
    cx: number,
    cy: number,
    r: number,
): boolean => {
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
};
