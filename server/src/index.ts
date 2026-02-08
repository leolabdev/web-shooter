import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
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

io.on("connection", (socket) => {
    console.log("connected", socket.id);
    socket.emit("rooms:list", { rooms: roomManager.getRoomsSummary() });

    socket.on("room:create", ({ name }) => {
        const room = roomManager.createRoom({ id: socket.id, name });
        socket.join(room.id);
        socket.emit("room:created", { roomId: room.id, playerId: socket.id });
        broadcastRoomsList();
    });

    socket.on("room:join", ({ roomId, name }) => {
        const room = roomManager.joinRoom(roomId, { id: socket.id, name });
        if (!room) {
            socket.emit("error", { message: "Room not found." });
            return;
        }
        socket.join(room.id);
        socket.emit("room:joined", { roomId: room.id, playerId: socket.id });
        broadcastRoomsList();
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
