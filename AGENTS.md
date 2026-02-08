# Multiverse Arena (MVP)

## Goal
Minimal multiplayer 2D top-down arena shooter with a sci-fi "Portal Echo" ability.
Single-screen arena: 1200x800 (no camera).
Client: React + RxJS + Canvas.
Server: Node + TypeScript + Socket.IO.
Server is authoritative.

## Hard constraints
- Only implement:
    - create/join room (roomId)
    - move (WASD), aim (mouse), shoot (LMB hold)
    - bullets + hits + HP=3 + death + respawn
    - ability: Portal Echo (key E), delay=900ms, lifetime=3500ms, cooldown=8000ms
    - basic HUD: roomId, ping, scoreboard (kills/deaths), echo cooldown
- No database, no auth, no matchmaking, no persistence.
- Keep libraries minimal: socket.io, socket.io-client, rxjs, react, vite.
- Use /shared/protocol.ts event maps for all socket events.

## Tick / rates
- Server tick: 20Hz (50ms).
- Client sends input: 20Hz (sampleTime 50ms).
- Server broadcasts state snapshot: every tick.

## Deliverables
- /server: `npm run dev` starts Socket.IO server on :8080
- /client: `npm run dev` starts Vite client
- Open two tabs -> join same room -> see each other move/shoot and use echo.
