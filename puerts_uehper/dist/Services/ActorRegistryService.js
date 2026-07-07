"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActorRegistryService = void 0;
class ActorRegistryService {
    constructor() {
        this.entries = new Map();
        this.tagIndex = new Map();
        this.classIndex = new Map();
    }
    register(id, actor, options = {}) {
        if (!id) {
            throw new Error('ActorRegistryService.register requires a non-empty id');
        }
        if (this.entries.has(id)) {
            this.unregister(id);
        }
        const entry = {
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
    unregister(id) {
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
    findById(id) {
        return this.entries.get(id)?.actor;
    }
    getEntry(id) {
        return this.entries.get(id);
    }
    findByTag(tag) {
        return this.getActorsFromIndex(this.tagIndex, tag);
    }
    findByClass(className) {
        return this.getActorsFromIndex(this.classIndex, className);
    }
    getAll() {
        return Array.from(this.entries.values()).map((entry) => entry.actor);
    }
    getAllEntries() {
        return Array.from(this.entries.values());
    }
    clear() {
        this.entries.clear();
        this.tagIndex.clear();
        this.classIndex.clear();
    }
    dispose() {
        this.clear();
    }
    getActorsFromIndex(index, key) {
        const ids = index.get(key);
        if (!ids) {
            return [];
        }
        const actors = [];
        for (const id of ids) {
            const entry = this.entries.get(id);
            if (entry) {
                actors.push(entry.actor);
            }
        }
        return actors;
    }
    addIndex(index, key, id) {
        let ids = index.get(key);
        if (!ids) {
            ids = new Set();
            index.set(key, ids);
        }
        ids.add(id);
    }
    removeIndex(index, key, id) {
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
exports.ActorRegistryService = ActorRegistryService;
//# sourceMappingURL=ActorRegistryService.js.map