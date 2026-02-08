import { createServer } from "node:http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
    console.log("connected", socket.id);
    socket.on("disconnect", () => console.log("disconnected", socket.id));
});

httpServer.listen(8080, () => console.log("server on :8080"));


