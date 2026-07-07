import type { PlayerId } from './PlayerRegistryService';
export type PortUnsubscribe = () => void;
export interface RoomMemberInfo {
    readonly playerId: PlayerId;
    readonly displayName?: string;
    readonly userId?: string;
    readonly isHost?: boolean;
    readonly metadata?: Record<string, unknown>;
}
export interface RoomSnapshot {
    readonly roomId: string;
    readonly hostPlayerId?: PlayerId;
    readonly members: readonly RoomMemberInfo[];
    readonly metadata?: Record<string, unknown>;
}
export interface RoomSessionPort {
    getCurrentRoom(): RoomSnapshot | undefined;
    getLocalPlayerId(): PlayerId | undefined;
    leaveRoom(reason?: string): Promise<void> | void;
    onRoomChanged(handler: (room: RoomSnapshot | undefined) => void): PortUnsubscribe;
}
//# sourceMappingURL=MultiplayerPorts.d.ts.map