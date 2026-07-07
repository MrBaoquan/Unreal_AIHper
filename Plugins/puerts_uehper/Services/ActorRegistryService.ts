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

export class ActorRegistryService {
    private readonly entries = new Map<string, ActorRegistryEntry>();
    private readonly tagIndex = new Map<string, Set<string>>();
    private readonly classIndex = new Map<string, Set<string>>();

    register<TActor>(id: string, actor: TActor, options: ActorRegistryRegisterOptions = {}): ActorRegistryEntry<TActor> {
        if (!id) {
            throw new Error('ActorRegistryService.register requires a non-empty id');
        }
        if (this.entries.has(id)) {
            this.unregister(id);
        }

        const entry: ActorRegistryEntry<TActor> = {
            id,
            actor,
            tags: [...(options.tags ?? [])],
            className: options.className,
            metadata: options.metadata ? { ...options.metadata } : undefined,
        };
        this.entries.set(id, entry);
        for (const tag of entry.tags) {
            this.addIndex(this.tagIndex, tag, id);
        }
        if (entry.className) {
            this.addIndex(this.classIndex, entry.className, id);
        }
        return entry;
    }

    unregister(id: string): boolean {
        const entry = this.entries.get(id);
        if (!entry) {
            return false;
        }
        this.entries.delete(id);
        for (const tag of entry.tags) {
            this.removeIndex(this.tagIndex, tag, id);
        }
        if (entry.className) {
            this.removeIndex(this.classIndex, entry.className, id);
        }
        return true;
    }

    findById<TActor = unknown>(id: string): TActor | undefined {
        return this.entries.get(id)?.actor as TActor | undefined;
    }

    getEntry<TActor = unknown>(id: string): ActorRegistryEntry<TActor> | undefined {
        return this.entries.get(id) as ActorRegistryEntry<TActor> | undefined;
    }

    findByTag<TActor = unknown>(tag: string): TActor[] {
        return this.getActorsFromIndex<TActor>(this.tagIndex, tag);
    }

    findByClass<TActor = unknown>(className: string): TActor[] {
        return this.getActorsFromIndex<TActor>(this.classIndex, className);
    }

    getAll<TActor = unknown>(): TActor[] {
        return Array.from(this.entries.values()).map((entry) => entry.actor as TActor);
    }

    getAllEntries<TActor = unknown>(): ActorRegistryEntry<TActor>[] {
        return Array.from(this.entries.values()) as ActorRegistryEntry<TActor>[];
    }

    clear(): void {
        this.entries.clear();
        this.tagIndex.clear();
        this.classIndex.clear();
    }

    dispose(): void {
        this.clear();
    }

    private getActorsFromIndex<TActor>(index: Map<string, Set<string>>, key: string): TActor[] {
        const ids = index.get(key);
        if (!ids) {
            return [];
        }
        const actors: TActor[] = [];
        for (const id of ids) {
            const entry = this.entries.get(id);
            if (entry) {
                actors.push(entry.actor as TActor);
            }
        }
        return actors;
    }

    private addIndex(index: Map<string, Set<string>>, key: string, id: string): void {
        let ids = index.get(key);
        if (!ids) {
            ids = new Set<string>();
            index.set(key, ids);
        }
        ids.add(id);
    }

    private removeIndex(index: Map<string, Set<string>>, key: string, id: string): void {
        const ids = index.get(key);
        if (!ids) {
            return;
        }
        ids.delete(id);
        if (ids.size === 0) {
            index.delete(key);
        }
    }
}