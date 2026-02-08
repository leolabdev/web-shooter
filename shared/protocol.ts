export const ARENA = { w: 1200, h: 800 } as const;

export type Vec2 = { x: number; y: number };

export type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };

export type PlayerState = {
    id: string;
    name: string;
    x: number;
    y: number;
    r: number;
    hp: number;
    alive: boolean;
    kills: number;
    deaths: number;

    isEcho: boolean;
    ownerId?: string;

    heldItem?: AbilityType | null;
};


export type BulletState = {
    id: string;
    ownerId: string;   // entity id (player or echo)
    ownerRootId: string; // original player id (for scoring)
    x: number;
    y: number;
    vx: number;
    vy: number;
    ttlMs: number;
};

export type GameEvent =
    | { type: "hit"; targetId: string; byRootId: string }
    | { type: "death"; id: string; byRootId?: string }
    | { type: "spawn_echo"; ownerId: string; echoId: string };

export type MatchPhase = "lobby" | "playing" | "ended";

export type MatchState = {
    phase: MatchPhase;
    hostId: string;
    startedAtMs?: number;
    endsAtMs?: number;
    durationSec: number;
};

export type StateSnapshot = {
    t: number;
    roomId: string;
    you: { playerId: string };
    players: PlayerState[];
    bullets: BulletState[];
    events: GameEvent[];
    pickups: PickupState[];
    zones: ZoneState[];
    match: MatchState;
};

export type ClientToServerEvents = {
    "room:create": (payload: {
        name: string;
        maxPlayers: number;
        isPrivate?: boolean;
    }) => void;
    "room:join": (payload: { roomId: string; name: string }) => void;

    // sent at 20Hz
    "player:input": (payload: {
        seq: number;
        dt: number; // ms since last input packet on client side (informational)
        keys: Keys;
        aim: Vec2; // aim in arena coords (0..w, 0..h)
        shoot: boolean;
        useItem: boolean; // one-shot
    }) => void;

    "match:configure": (payload: { durationSec: number }) => void;
    "match:start": () => void;
    "match:restart": () => void;

    "net:ping": (payload: { t: number }) => void;

    "chat:send": (payload: { text: string }) => void;
};

export type ServerToClientEvents = {
    "room:created": (payload: { roomId: string; playerId: string }) => void;
    "room:joined": (payload: { roomId: string; playerId: string }) => void;
    "rooms:list": (payload: {
        rooms: {
            roomId: string;
            playerCount: number;
            maxPlayers: number;
            isPrivate: boolean;
        }[];
    }) => void;
    "game:state": (payload: StateSnapshot) => void;
    "net:pong": (payload: { t: number }) => void;
    "error": (payload: { message: string }) => void;

    "chat:message": (payload: ChatMessage) => void;
    "chat:history": (payload: { messages: ChatMessage[] }) => void;
    "match:toast": (payload: { message: string }) => void;
};


export type AbilityType = "echo" | "time_bubble" | "phase_dash";

export type PickupState = {
    id: string;
    type: AbilityType;
    x: number;
    y: number;
    r: number;
};

export type ZoneState = {
    id: string;
    kind: "time_bubble";
    x: number;
    y: number;
    r: number;
    expiresAtMs: number;
};

export type ChatMessage = {
    id: string;
    roomId: string;
    fromId: string;
    fromName: string;
    text: string;
    t: number;
};
