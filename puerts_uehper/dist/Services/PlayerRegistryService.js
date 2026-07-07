"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerRegistryService = void 0;
class PlayerRegistryService {
    constructor() {
        this.entries = new Map();
    }
    register(playerId, options = {}) {
        this.assertPlayerId(playerId);
        const nowSeconds = options.nowSeconds ?? this.nowSeconds();
        const existing = this.entries.get(playerId);
        const entry = {
            playerId,
            displayName: options.displayName ?? existing?.displayName,
            userId: options.userId ?? existing?.userId,
            teamId: options.teamId ?? existing?.teamId,
            isLocal: options.isLocal ?? existing?.isLocal ?? false,
            state: options.state ?? existing?.state ?? 'connected',
            controller: options.controller ?? existing?.controller,
            pawn: options.pawn ?? existing?.pawn,
            metadata: this.mergeMetadata(existing?.metadata, options.metadata),
            joinedAtSeconds: existing?.joinedAtSeconds ?? nowSeconds,
            updatedAtSeconds: nowSeconds,
        };
        this.entries.set(playerId, entry);
        return this.toReadonlyEntry(entry);
    }
    update(playerId, options) {
        const entry = this.requireMutableEntry(playerId);
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
        return this.toReadonlyEntry(entry);
    }
    unregister(playerId) {
        return this.entries.delete(playerId);
    }
    setConnectionState(playerId, state, nowSeconds = this.nowSeconds()) {
        return this.update(playerId, { state, nowSeconds });
    }
    setReady(playerId, ready = true, nowSeconds = this.nowSeconds()) {
        return this.setConnectionState(playerId, ready ? 'ready' : 'connected', nowSeconds);
    }
    has(playerId) {
        return this.entries.has(playerId);
    }
    get(playerId) {
        const entry = this.entries.get(playerId);
        return entry ? this.toReadonlyEntry(entry) : undefined;
    }
    require(playerId) {
        return this.toReadonlyEntry(this.requireMutableEntry(playerId));
    }
    getAll() {
        return Array.from(this.entries.values()).map((entry) => this.toReadonlyEntry(entry));
    }
    getByState(state) {
        return this.getAll().filter((entry) => entry.state === state);
    }
    getReadyPlayerIds() {
        return this.getByState('ready').map((entry) => entry.playerId);
    }
    getLocalPlayer() {
        const entry = Array.from(this.entries.values()).find((item) => item.isLocal);
        return entry ? this.toReadonlyEntry(entry) : undefined;
    }
    getByTeam(teamId) {
        return this.getAll().filter((entry) => entry.teamId === teamId);
    }
    clear() {
        this.entries.clear();
    }
    dispose() {
        this.clear();
    }
    requireMutableEntry(playerId) {
        this.assertPlayerId(playerId);
        const entry = this.entries.get(playerId);
        if (!entry) {
            throw new Error(`Player not registered: ${playerId}`);
        }
        return entry;
    }
    assertPlayerId(playerId) {
        if (playerId === '' || playerId === undefined || playerId === null) {
            throw new Error('PlayerRegistryService requires a non-empty playerId');
        }
    }
    mergeMetadata(current, next) {
        if (!current && !next) {
            return undefined;
        }
        return { ...(current ?? {}), ...(next ?? {}) };
    }
    toReadonlyEntry(entry) {
        return {
            playerId: entry.playerId,
            displayName: entry.displayName,
            userId: entry.userId,
            teamId: entry.teamId,
            isLocal: entry.isLocal,
            state: entry.state,
            controller: entry.controller,
            pawn: entry.pawn,
            metadata: entry.metadata ? { ...entry.metadata } : undefined,
            joinedAtSeconds: entry.joinedAtSeconds,
            updatedAtSeconds: entry.updatedAtSeconds,
        };
    }
    nowSeconds() {
        return Date.now() / 1000;
    }
}
exports.PlayerRegistryService = PlayerRegistryService;
//# sourceMappingURL=PlayerRegistryService.js.map