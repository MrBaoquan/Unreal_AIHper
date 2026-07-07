import type { PlayerId } from './PlayerRegistryService';
import type { PlayerSyncPort, PortUnsubscribe, WorldStatePatch } from './MultiplayerPorts';

export type ActorStateSyncPatchKind = 'spawned' | 'updated' | 'destroyed' | 'fullSnapshot';

export interface ActorStateVectorSnapshot {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface ActorStateRotatorSnapshot {
    readonly pitch: number;
    readonly yaw: number;
    readonly roll: number;
}

export interface ActorTransformSnapshot {
    readonly location?: ActorStateVectorSnapshot;
    readonly rotation?: ActorStateRotatorSnapshot;
    readonly scale?: ActorStateVectorSnapshot;
    readonly velocity?: ActorStateVectorSnapshot;
}

export interface ActorStateSnapshot<TState extends Record<string, unknown> = Record<string, unknown>> {
    readonly actorId: string;
    readonly className?: string;
    readonly ownerPlayerId?: PlayerId;
    readonly version: number;
    readonly timeSeconds: number;
    readonly transform?: ActorTransformSnapshot;
    readonly state?: TState;
    readonly tags?: readonly string[];
    readonly destroyed?: boolean;
    readonly metadata?: Record<string, unknown>;
}

export interface ActorStatePatchPayload<TState extends Record<string, unknown> = Record<string, unknown>> {
    readonly kind: ActorStateSyncPatchKind;
    readonly actorId?: string;
    readonly actors: readonly ActorStateSnapshot<TState>[];
}

export interface ActorStateSampler<TActor = unknown, TState extends Record<string, unknown> = Record<string, unknown>> {
    sample(actor: TActor, previous: ActorStateSnapshot<TState> | undefined, timeSeconds: number): ActorStateSnapshot<TState> | undefined;
}

export interface ActorStateApplier<TState extends Record<string, unknown> = Record<string, unknown>> {
    spawn?(snapshot: ActorStateSnapshot<TState>): void;
    update?(snapshot: ActorStateSnapshot<TState>, previous: ActorStateSnapshot<TState> | undefined): void;
    destroy?(snapshot: ActorStateSnapshot<TState> | undefined, actorId: string): void;
}

export interface ActorStateSyncRegisterOptions {
    readonly minIntervalSeconds?: number;
}

export interface ActorStateSyncPublishOptions {
    readonly sourcePlayerId?: PlayerId;
    readonly metadata?: Record<string, unknown>;
}

interface RegisteredActor<TActor = unknown, TState extends Record<string, unknown> = Record<string, unknown>> {
    readonly actor: TActor;
    readonly sampler: ActorStateSampler<TActor, TState>;
    readonly minIntervalSeconds: number;
    lastSampleTimeSeconds: number;
}

export class ActorStateSyncService {
    private readonly actors = new Map<string, RegisteredActor>();
    private readonly snapshots = new Map<string, ActorStateSnapshot>();
    private readonly appliers = new Map<string, ActorStateApplier>();
    private transport?: PlayerSyncPort;
    private transportUnsubscribe?: PortUnsubscribe;
    private nextPatchId = 1;

    attachTransport(transport: PlayerSyncPort): void {
        this.detachTransport();
        this.transport = transport;
        this.transportUnsubscribe = transport.onWorldStatePatch((patch) => this.applyWorldStatePatch(patch));
    }

    detachTransport(): void {
        this.transportUnsubscribe?.();
        this.transportUnsubscribe = undefined;
        this.transport = undefined;
    }

    registerActor<TActor, TState extends Record<string, unknown> = Record<string, unknown>>(actorId: string, actor: TActor, sampler: ActorStateSampler<TActor, TState>, options: ActorStateSyncRegisterOptions = {}): void {
        if (!actorId) {
            throw new Error('ActorStateSyncService.registerActor requires a non-empty actorId');
        }
        this.actors.set(actorId, {
            actor,
            sampler: sampler as ActorStateSampler,
            minIntervalSeconds: Math.max(0, options.minIntervalSeconds ?? 0),
            lastSampleTimeSeconds: Number.NEGATIVE_INFINITY,
        });
    }

    unregisterActor(actorId: string, publishDestroy = false, options: ActorStateSyncPublishOptions = {}): boolean {
        const removed = this.actors.delete(actorId);
        if (publishDestroy) {
            this.publishDestroyed(actorId, options);
        }
        return removed;
    }

    registerApplier(className: string, applier: ActorStateApplier): void {
        if (!className) {
            throw new Error('ActorStateSyncService.registerApplier requires a non-empty className');
        }
        this.appliers.set(className, applier);
    }

    unregisterApplier(className: string): boolean {
        return this.appliers.delete(className);
    }

    getSnapshot<TState extends Record<string, unknown> = Record<string, unknown>>(actorId: string): ActorStateSnapshot<TState> | undefined {
        return this.snapshots.get(actorId) as ActorStateSnapshot<TState> | undefined;
    }

    getAllSnapshots<TState extends Record<string, unknown> = Record<string, unknown>>(): ActorStateSnapshot<TState>[] {
        return Array.from(this.snapshots.values()) as ActorStateSnapshot<TState>[];
    }

    sampleRegisteredActors(timeSeconds = Date.now() / 1000, options: ActorStateSyncPublishOptions = {}): ActorStateSnapshot[] {
        const sampled: ActorStateSnapshot[] = [];
        for (const [actorId, entry] of this.actors) {
            if (timeSeconds - entry.lastSampleTimeSeconds < entry.minIntervalSeconds) {
                continue;
            }
            const snapshot = entry.sampler.sample(entry.actor, this.snapshots.get(actorId), timeSeconds);
            entry.lastSampleTimeSeconds = timeSeconds;
            if (!snapshot) {
                continue;
            }
            this.commitSnapshot(snapshot);
            sampled.push(snapshot);
        }
        if (sampled.length > 0) {
            this.publishPatch('updated', sampled, options);
        }
        return sampled;
    }

    publishSnapshot(snapshot: ActorStateSnapshot, kind: ActorStateSyncPatchKind = 'updated', options: ActorStateSyncPublishOptions = {}): void {
        this.commitSnapshot(snapshot);
        this.publishPatch(kind, [snapshot], options);
    }

    publishFullSnapshot(options: ActorStateSyncPublishOptions = {}): void {
        const snapshots = this.getAllSnapshots();
        if (snapshots.length > 0) {
            this.publishPatch('fullSnapshot', snapshots, options);
        }
    }

    publishDestroyed(actorId: string, options: ActorStateSyncPublishOptions = {}): void {
        const previous = this.snapshots.get(actorId);
        const snapshot: ActorStateSnapshot = previous
            ? { ...previous, destroyed: true, version: previous.version + 1, timeSeconds: Date.now() / 1000 }
            : { actorId, destroyed: true, version: 1, timeSeconds: Date.now() / 1000 };
        this.snapshots.delete(actorId);
        this.publishPatch('destroyed', [snapshot], options);
    }

    applyWorldStatePatch(patch: WorldStatePatch): void {
        if (!this.isActorStatePatch(patch)) {
            return;
        }
        const payload = patch.payload as ActorStatePatchPayload;
        for (const snapshot of payload.actors) {
            if (payload.kind === 'destroyed' || snapshot.destroyed) {
                this.applyDestroyed(snapshot.actorId, snapshot);
                continue;
            }
            this.applySnapshot(snapshot, payload.kind);
        }
    }

    clear(): void {
        this.actors.clear();
        this.snapshots.clear();
        this.appliers.clear();
    }

    dispose(): void {
        this.detachTransport();
        this.clear();
    }

    private commitSnapshot(snapshot: ActorStateSnapshot): void {
        const previous = this.snapshots.get(snapshot.actorId);
        if (!previous || snapshot.version >= previous.version) {
            this.snapshots.set(snapshot.actorId, snapshot);
        }
    }

    private applySnapshot(snapshot: ActorStateSnapshot, kind: ActorStateSyncPatchKind): void {
        const previous = this.snapshots.get(snapshot.actorId);
        if (previous && snapshot.version < previous.version) {
            return;
        }
        this.snapshots.set(snapshot.actorId, snapshot);
        const applier = this.resolveApplier(snapshot.className);
        if (kind === 'spawned') {
            applier?.spawn?.(snapshot);
        }
        applier?.update?.(snapshot, previous);
    }

    private applyDestroyed(actorId: string, snapshot: ActorStateSnapshot | undefined): void {
        const previous = this.snapshots.get(actorId) ?? snapshot;
        this.snapshots.delete(actorId);
        this.resolveApplier(previous?.className)?.destroy?.(previous, actorId);
    }

    private publishPatch(kind: ActorStateSyncPatchKind, actors: readonly ActorStateSnapshot[], options: ActorStateSyncPublishOptions): void {
        this.transport?.publishWorldStatePatch<ActorStatePatchPayload>({
            id: `actorState:${this.nextPatchId++}`,
            sourcePlayerId: options.sourcePlayerId,
            type: `actor.${kind}`,
            payload: { kind, actorId: actors.length === 1 ? actors[0].actorId : undefined, actors },
            serverTimeSeconds: Date.now() / 1000,
            metadata: options.metadata,
        });
    }

    private resolveApplier(className: string | undefined): ActorStateApplier | undefined {
        return (className ? this.appliers.get(className) : undefined) ?? this.appliers.get('*');
    }

    private isActorStatePatch(patch: WorldStatePatch): boolean {
        return typeof patch.type === 'string' && patch.type.startsWith('actor.') && this.isActorStatePatchPayload(patch.payload);
    }

    private isActorStatePatchPayload(payload: unknown): payload is ActorStatePatchPayload {
        const candidate = payload as ActorStatePatchPayload | undefined;
        return !!candidate && typeof candidate.kind === 'string' && Array.isArray(candidate.actors);
    }
}
