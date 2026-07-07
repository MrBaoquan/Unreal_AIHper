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

interface MutablePlayerRegistryEntry<TController = unknown, TPawn = unknown> {
    playerId: PlayerId;
    displayName?: string;
    userId?: string;
    teamId?: string;
    isLocal: boolean;
    state: PlayerConnectionState;
    controller?: TController;
    pawn?: TPawn;
    metadata?: Record<string, unknown>;
    joinedAtSeconds: number;
    updatedAtSeconds: number;
}

export class PlayerRegistryService {
    private readonly entries = new Map<PlayerId, MutablePlayerRegistryEntry>();

    register<TController = unknown, TPawn = unknown>(
        playerId: PlayerId,
        options: PlayerRegistryRegisterOptions<TController, TPawn> = {},
    ): PlayerRegistryEntry<TController, TPawn> {
        this.assertPlayerId(playerId);
        const nowSeconds = options.nowSeconds ?? this.nowSeconds();
        const existing = this.entries.get(playerId);
        const entry: MutablePlayerRegistryEntry<TController, TPawn> = {
            playerId,
            displayName: options.displayName ?? existing?.displayName,
            userId: options.userId ?? existing?.userId,
            teamId: options.teamId ?? existing?.teamId,
            isLocal: options.isLocal ?? existing?.isLocal ?? false,
            state: options.state ?? existing?.state ?? 'connected',
            controller: options.controller ?? (existing?.controller as TController | undefined),
            pawn: options.pawn ?? (existing?.pawn as TPawn | undefined),
            metadata: this.mergeMetadata(existing?.metadata, options.metadata),
            joinedAtSeconds: existing?.joinedAtSeconds ?? nowSeconds,
            updatedAtSeconds: nowSeconds,
        };
        this.entries.set(playerId, entry);
        return this.toReadonlyEntry<TController, TPawn>(entry);
    }

    update<TController = unknown, TPawn = unknown>(
        playerId: PlayerId,
        options: PlayerRegistryUpdateOptions<TController, TPawn>,
    ): PlayerRegistryEntry<TController, TPawn> {
        const entry = this.requireMutableEntry<TController, TPawn>(playerId);
        if (options.displayName !== undefined) {
            entry.displayName = options.displayName;
        }
        if (options.userId !== undefined) {
            entry.userId = options.userId;
        }
        if (options.teamId !== undefined) {
            entry.teamId = options.teamId;
        }
        if (options.isLocal !== undefined) {
            entry.isLocal = options.isLocal;
        }
        if (options.state !== undefined) {
            entry.state = options.state;
        }
        if (options.controller !== undefined) {
            entry.controller = options.controller;
        }
        if (options.pawn !== undefined) {
            entry.pawn = options.pawn;
        }
        if (options.metadata !== undefined) {
            entry.metadata = this.mergeMetadata(entry.metadata, options.metadata);
        }
        entry.updatedAtSeconds = options.nowSeconds ?? this.nowSeconds();
        return this.toReadonlyEntry<TController, TPawn>(entry);
    }

    unregister(playerId: PlayerId): boolean {
        return this.entries.delete(playerId);
    }

    setConnectionState(playerId: PlayerId, state: PlayerConnectionState, nowSeconds = this.nowSeconds()): PlayerRegistryEntry {
        return this.update(playerId, { state, nowSeconds });
    }

    setReady(playerId: PlayerId, ready = true, nowSeconds = this.nowSeconds()): PlayerRegistryEntry {
        return this.setConnectionState(playerId, ready ? 'ready' : 'connected', nowSeconds);
    }

    has(playerId: PlayerId): boolean {
        return this.entries.has(playerId);
    }

    get<TController = unknown, TPawn = unknown>(playerId: PlayerId): PlayerRegistryEntry<TController, TPawn> | undefined {
        const entry = this.entries.get(playerId);
        return entry ? this.toReadonlyEntry<TController, TPawn>(entry) : undefined;
    }

    require<TController = unknown, TPawn = unknown>(playerId: PlayerId): PlayerRegistryEntry<TController, TPawn> {
        return this.toReadonlyEntry<TController, TPawn>(this.requireMutableEntry(playerId));
    }

    getAll<TController = unknown, TPawn = unknown>(): PlayerRegistryEntry<TController, TPawn>[] {
        return Array.from(this.entries.values()).map((entry) => this.toReadonlyEntry<TController, TPawn>(entry));
    }

    getByState(state: PlayerConnectionState): PlayerRegistryEntry[] {
        return this.getAll().filter((entry) => entry.state === state);
    }

    getReadyPlayerIds(): PlayerId[] {
        return this.getByState('ready').map((entry) => entry.playerId);
    }

    getLocalPlayer<TController = unknown, TPawn = unknown>(): PlayerRegistryEntry<TController, TPawn> | undefined {
        const entry = Array.from(this.entries.values()).find((item) => item.isLocal);
        return entry ? this.toReadonlyEntry<TController, TPawn>(entry) : undefined;
    }

    getByTeam(teamId: string): PlayerRegistryEntry[] {
        return this.getAll().filter((entry) => entry.teamId === teamId);
    }

    clear(): void {
        this.entries.clear();
    }

    dispose(): void {
        this.clear();
    }

    private requireMutableEntry<TController = unknown, TPawn = unknown>(playerId: PlayerId): MutablePlayerRegistryEntry<TController, TPawn> {
        this.assertPlayerId(playerId);
        const entry = this.entries.get(playerId);
        if (!entry) {
            throw new Error(`Player not registered: ${playerId}`);
        }
        return entry as MutablePlayerRegistryEntry<TController, TPawn>;
    }

    private assertPlayerId(playerId: PlayerId): void {
        if (playerId === '' || playerId === undefined || playerId === null) {
            throw new Error('PlayerRegistryService requires a non-empty playerId');
        }
    }

    private mergeMetadata(current?: Record<string, unknown>, next?: Record<string, unknown>): Record<string, unknown> | undefined {
        if (!current && !next) {
            return undefined;
        }
        return { ...(current ?? {}), ...(next ?? {}) };
    }

    private toReadonlyEntry<TController = unknown, TPawn = unknown>(entry: MutablePlayerRegistryEntry): PlayerRegistryEntry<TController, TPawn> {
        return {
            playerId: entry.playerId,
            displayName: entry.displayName,
            userId: entry.userId,
            teamId: entry.teamId,
            isLocal: entry.isLocal,
            state: entry.state,
            controller: entry.controller as TController | undefined,
            pawn: entry.pawn as TPawn | undefined,
            metadata: entry.metadata ? { ...entry.metadata } : undefined,
            joinedAtSeconds: entry.joinedAtSeconds,
            updatedAtSeconds: entry.updatedAtSeconds,
        };
    }

    private nowSeconds(): number {
        return Date.now() / 1000;
    }
}