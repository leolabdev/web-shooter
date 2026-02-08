import type { Server } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from "../../shared/protocol";
import { Room, RoomPlayer } from "./room";

type CreateRoomOptions = {
    maxPlayers: number;
    isPrivate: boolean;
    fillWithBots: boolean;
    botCount: number;
    botDifficulty: "easy" | "normal" | "hard";
};

export class RoomManager {
    private rooms = new Map<string, Room>();
    private playerToRoom = new Map<string, string>();
    private io: Server<ClientToServerEvents, ServerToClientEvents>;

    constructor(io: Server<ClientToServerEvents, ServerToClientEvents>) {
        this.io = io;
    }

    createRoom(player: RoomPlayer, options: CreateRoomOptions): Room {
        const roomId = this.createRoomId();
        const room = new Room(
            roomId,
            this.io,
            options.maxPlayers,
            options.isPrivate,
            options.fillWithBots,
            options.botCount,
            options.botDifficulty,
            player.id,
        );
        room.addPlayer(player);
        this.rooms.set(roomId, room);
        this.playerToRoom.set(player.id, roomId);
        return room;
    }

    joinRoom(roomId: string, player: RoomPlayer): Room | null {
        const normalizedRoomId = this.normalizeRoomId(roomId);
        const room = this.rooms.get(normalizedRoomId);
        if (!room) return null;
        room.addPlayer(player);
        this.playerToRoom.set(player.id, normalizedRoomId);
        return room;
    }

    removePlayer(playerId: string): string | null {
        const roomId = this.playerToRoom.get(playerId);
        if (!roomId) return null;
        const room = this.rooms.get(roomId);
        if (!room) {
            this.playerToRoom.delete(playerId);
            return null;
        }
        room.removePlayer(playerId);
        this.playerToRoom.delete(playerId);
        if (room.isEmpty()) {
            room.stop();
            this.rooms.delete(roomId);
        }
        return roomId;
    }

    getRoom(roomId: string): Room | null {
        const normalizedRoomId = this.normalizeRoomId(roomId);
        return this.rooms.get(normalizedRoomId) ?? null;
    }

    getRoomByPlayer(playerId: string): Room | null {
        const roomId = this.playerToRoom.get(playerId);
        if (!roomId) return null;
        return this.getRoom(roomId);
    }

    private createRoomId(): string {
        let roomId = this.randomId();
        while (this.rooms.has(roomId)) {
            roomId = this.randomId();
        }
        return roomId;
    }

    private randomId(): string {
        return Math.random().toString(36).slice(2, 8).toUpperCase();
    }

    private normalizeRoomId(roomId: string): string {
        return roomId.trim().toUpperCase();
    }

    getRoomsSummary(): {
        roomId: string;
        playerCount: number;
        maxPlayers: number;
        isPrivate: boolean;
        fillWithBots: boolean;
        botCount: number;
        botDifficulty: "easy" | "normal" | "hard";
    }[] {
        return Array.from(this.rooms.values())
            .filter((room) => !room.isPrivate)
            .map((room) => ({
                roomId: room.id,
                playerCount: room.getPlayerCount(),
                maxPlayers: room.maxPlayers,
                isPrivate: room.isPrivate,
                fillWithBots: room.fillWithBots,
                botCount: room.botCount,
                botDifficulty: room.botDifficulty,
            }));
    }
}
