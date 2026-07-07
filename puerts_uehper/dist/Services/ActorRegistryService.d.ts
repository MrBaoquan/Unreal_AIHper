export interface ActorRegistryEntry<TActor = unknown> {
    readonly id: string;
    readonly actor: TActor;
    readonly tags: readonly string[];
    readonly className?: string;
    readonly metadata?: Record<string, unknown>;
}
export interface ActorRegistryRegisterOptions {
    readonly tags?: readonly string[];
    readonly className?: string;
    readonly metadata?: Record<string, unknown>;
}
export declare class ActorRegistryService {
    private readonly entries;
    private readonly tagIndex;
    private readonly classIndex;
    register<TActor>(id: string, actor: TActor, options?: ActorRegistryRegisterOptions): ActorRegistryEntry<TActor>;
    unregister(id: string): boolean;
    findById<TActor = unknown>(id: string): TActor | undefined;
    getEntry<TActor = unknown>(id: string): ActorRegistryEntry<TActor> | undefined;
    findByTag<TActor = unknown>(tag: string): TActor[];
    findByClass<TActor = unknown>(className: string): TActor[];
    getAll<TActor = unknown>(): TActor[];
    getAllEntries<TActor = unknown>(): ActorRegistryEntry<TActor>[];
    clear(): void;
    dispose(): void;
    private getActorsFromIndex;
    private addIndex;
    private removeIndex;
}
//# sourceMappingURL=ActorRegistryService.d.ts.map