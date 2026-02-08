import { Room, RoomPlayer } from "./room";

export class RoomManager {
    private rooms = new Map<string, Room>();
    private playerToRoom = new Map<string, string>();

    createRoom(player: RoomPlayer): Room {
        const roomId = this.createRoomId();
        const room = new Room(roomId);
        room.addPlayer(player);
        this.rooms.set(roomId, room);
        this.playerToRoom.set(player.id, roomId);
        return room;
    }

    joinRoom(roomId: string, player: RoomPlayer): Room | null {
        const room = this.rooms.get(roomId);
        if (!room) return null;
        room.addPlayer(player);
        this.playerToRoom.set(player.id, roomId);
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
            this.rooms.delete(roomId);
        }
        return roomId;
    }

    private createRoomId(): string {
        let roomId = this.randomId();
        while (this.rooms.has(roomId)) {
            roomId = this.randomId();
        }
        return roomId;
    }

    private randomId(): string {
        return Math.random().toString(36).slice(2, 8);
    }
}
