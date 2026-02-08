import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
    ChatMessage,
    ClientToServerEvents,
    ServerToClientEvents,
} from "../../shared/protocol";
import { RoomManager } from "./roomManager";

const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: "*" },
});
const roomManager = new RoomManager(io);
const broadcastRoomsList = () => {
    io.emit("rooms:list", { rooms: roomManager.getRoomsSummary() });
};

const normalizeRoomId = (roomId: string): string => roomId.trim().toUpperCase();

const normalizeName = (name: string): string => {
    const trimmed = name.trim().slice(0, 16);
    if (trimmed.length > 0) return trimmed;
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `Player-${suffix}`;
};

const clampMaxPlayers = (value: number | undefined): number => {
    if (!Number.isFinite(value)) return 8;
    return Math.min(12, Math.max(2, Math.floor(value)));
};

io.on("connection", (socket) => {
    console.log("connected", socket.id);
    socket.emit("rooms:list", { rooms: roomManager.getRoomsSummary() });

    socket.on("room:create", ({ name, maxPlayers, isPrivate }) => {
        const room = roomManager.createRoom(
            { id: socket.id, name: normalizeName(name) },
            { maxPlayers: clampMaxPlayers(maxPlayers), isPrivate: !!isPrivate },
        );
        socket.join(room.id);
        socket.emit("room:created", { roomId: room.id, playerId: socket.id });
        socket.emit("chat:history", { messages: room.getChatHistory() });
        broadcastRoomsList();
    });

    socket.on("room:join", ({ roomId, name }) => {
        const normalizedRoomId = normalizeRoomId(roomId);
        const room = roomManager.getRoom(normalizedRoomId);
        if (!room) {
            socket.emit("error", { message: "Room not found." });
            return;
        }
        if (room.isFull()) {
            socket.emit("error", { message: "Room is full." });
            return;
        }
        const joinedRoom = roomManager.joinRoom(normalizedRoomId, {
            id: socket.id,
            name: normalizeName(name),
        });
        if (!joinedRoom) {
            socket.emit("error", { message: "Room not found." });
            return;
        }
        socket.join(joinedRoom.id);
        socket.emit("room:joined", { roomId: joinedRoom.id, playerId: socket.id });
        socket.emit("chat:history", { messages: joinedRoom.getChatHistory() });
        broadcastRoomsList();
    });

    socket.on("match:configure", ({ durationSec }) => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room) return;
        if (room.match.hostId !== socket.id) return;
        if (room.match.phase !== "lobby") return;
        room.configureMatchDuration(durationSec);
        io.to(room.id).emit("match:toast", { message: "Match duration updated" });
    });

    socket.on("match:start", () => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room) return;
        if (room.match.hostId !== socket.id) return;
        if (room.match.phase !== "lobby") return;
        room.startMatch(Date.now());
    });

    socket.on("match:restart", () => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room) return;
        if (room.match.hostId !== socket.id) return;
        if (room.match.phase === "lobby") return;
        room.restartMatch();
    });

    socket.on("chat:send", ({ text }) => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room) return;
        const normalized = text.trim().slice(0, 120);
        if (!normalized) return;
        const fromName = room.getPlayerName(socket.id) ?? "Unknown";
        const message: ChatMessage = {
            id: Math.random().toString(36).slice(2, 8),
            roomId: room.id,
            fromId: socket.id,
            fromName,
            text: normalized,
            t: Date.now(),
        };
        room.addChatMessage(message);
        io.to(room.id).emit("chat:message", message);
    });

    socket.on("player:input", (payload) => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room) return;
        room.handleInput(socket.id, payload);
    });

    socket.on("net:ping", ({ t }) => {
        socket.emit("net:pong", { t });
    });

    socket.on("disconnect", () => {
        roomManager.removePlayer(socket.id);
        broadcastRoomsList();
        console.log("disconnected", socket.id);
    });
});

httpServer.listen(8080, () => console.log("server on :8080"));
