export type RoomPlayer = {
    id: string;
    name: string;
};

export class Room {
    readonly id: string;
    private players = new Map<string, RoomPlayer>();

    constructor(id: string) {
        this.id = id;
    }

    addPlayer(player: RoomPlayer): void {
        this.players.set(player.id, player);
    }

    removePlayer(playerId: string): void {
        this.players.delete(playerId);
    }

    hasPlayer(playerId: string): boolean {
        return this.players.has(playerId);
    }

    isEmpty(): boolean {
        return this.players.size === 0;
    }
}
