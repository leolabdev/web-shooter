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
const roomManager = new RoomManager();

io.on("connection", (socket) => {
    console.log("connected", socket.id);

    socket.on("room:create", ({ name }) => {
        const room = roomManager.createRoom({ id: socket.id, name });
        socket.join(room.id);
        socket.emit("room:created", { roomId: room.id, playerId: socket.id });
    });

    socket.on("room:join", ({ roomId, name }) => {
        const room = roomManager.joinRoom(roomId, { id: socket.id, name });
        if (!room) {
            socket.emit("error", { message: "Room not found." });
            return;
        }
        socket.join(room.id);
        socket.emit("room:joined", { roomId: room.id, playerId: socket.id });
    });

    socket.on("disconnect", () => {
        roomManager.removePlayer(socket.id);
        console.log("disconnected", socket.id);
    });
});

httpServer.listen(8080, () => console.log("server on :8080"));
