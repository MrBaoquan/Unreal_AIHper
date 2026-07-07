export type PlayerId = string | number;
export type PlayerConnectionState = 'joining' | 'connected' | 'ready' | 'disconnected';
export interface PlayerRegistryEntry<TController = unknown, TPawn = unknown> {
    readonly playerId: PlayerId;
    readonly displayName?: string;
    readonly userId?: string;
    readonly teamId?: string;
    readonly isLocal: boolean;
    readonly state: PlayerConnectionState;
    readonly controller?: TController;
    readonly pawn?: TPawn;
    readonly metadata?: Record<string, unknown>;
    readonly joinedAtSeconds: number;
    readonly updatedAtSeconds: number;
}
export interface PlayerRegistryRegisterOptions<TController = unknown, TPawn = unknown> {
    readonly displayName?: string;
    readonly userId?: string;
    readonly teamId?: string;
    readonly isLocal?: boolean;
    readonly state?: PlayerConnectionState;
    readonly controller?: TController;
    readonly pawn?: TPawn;
    readonly metadata?: Record<string, unknown>;
    readonly nowSeconds?: number;
}
export interface PlayerRegistryUpdateOptions<TController = unknown, TPawn = unknown> {
    readonly displayName?: string;
    readonly userId?: string;
    readonly teamId?: string;
    readonly isLocal?: boolean;
    readonly state?: PlayerConnectionState;
    readonly controller?: TController;
    readonly pawn?: TPawn;
    readonly metadata?: Record<string, unknown>;
    readonly nowSeconds?: number;
}
export declare class PlayerRegistryService {
    private readonly entries;
    register<TController = unknown, TPawn = unknown>(playerId: PlayerId, options?: PlayerRegistryRegisterOptions<TController, TPawn>): PlayerRegistryEntry<TController, TPawn>;
    update<TController = unknown, TPawn = unknown>(playerId: PlayerId, options: PlayerRegistryUpdateOptions<TController, TPawn>): PlayerRegistryEntry<TController, TPawn>;
    unregister(playerId: PlayerId): boolean;
    setConnectionState(playerId: PlayerId, state: PlayerConnectionState, nowSeconds?: number): PlayerRegistryEntry;
    setReady(playerId: PlayerId, ready?: boolean, nowSeconds?: number): PlayerRegistryEntry;
    has(playerId: PlayerId): boolean;
    get<TController = unknown, TPawn = unknown>(playerId: PlayerId): PlayerRegistryEntry<TController, TPawn> | undefined;
    require<TController = unknown, TPawn = unknown>(playerId: PlayerId): PlayerRegistryEntry<TController, TPawn>;
    getAll<TController = unknown, TPawn = unknown>(): PlayerRegistryEntry<TController, TPawn>[];
    getByState(state: PlayerConnectionState): PlayerRegistryEntry[];
    getReadyPlayerIds(): PlayerId[];
    getLocalPlayer<TController = unknown, TPawn = unknown>(): PlayerRegistryEntry<TController, TPawn> | undefined;
    getByTeam(teamId: string): PlayerRegistryEntry[];
    clear(): void;
    dispose(): void;
    private requireMutableEntry;
    private assertPlayerId;
    private mergeMetadata;
    private toReadonlyEntry;
    private nowSeconds;
}
//# sourceMappingURL=PlayerRegistryService.d.ts.map