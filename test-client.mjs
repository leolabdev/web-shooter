import { io } from "socket.io-client";

const socket = io("http://localhost:8080");

socket.on("connect", () => {
    console.log("CONNECTED:", socket.id);
    socket.disconnect();
});

socket.on("connect_error", (err) => {
    console.error("Connection error:", err.message);
});
