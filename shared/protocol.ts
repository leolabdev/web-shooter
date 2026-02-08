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

    // included for the owning (real) player
    echoCdMs?: number;
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

export type StateSnapshot = {
    t: number;
    roomId: string;
    you: { playerId: string };
    players: PlayerState[];
    bullets: BulletState[];
    events: GameEvent[];
};

export type ClientToServerEvents = {
    "room:create": (payload: { name: string }) => void;
    "room:join": (payload: { roomId: string; name: string }) => void;

    // sent at 20Hz
    "player:input": (payload: {
        seq: number;
        dt: number; // ms since last input packet on client side (informational)
        keys: Keys;
        aim: Vec2; // aim in arena coords (0..w, 0..h)
        shoot: boolean;
        useEcho: boolean; // one-shot
    }) => void;

    "net:ping": (payload: { t: number }) => void;
};

export type ServerToClientEvents = {
    "room:created": (payload: { roomId: string; playerId: string }) => void;
    "room:joined": (payload: { roomId: string; playerId: string }) => void;
    "rooms:list": (payload: {
        rooms: { roomId: string; playerCount: number }[];
    }) => void;
    "game:state": (payload: StateSnapshot) => void;
    "net:pong": (payload: { t: number }) => void;
    "error": (payload: { message: string }) => void;
};
