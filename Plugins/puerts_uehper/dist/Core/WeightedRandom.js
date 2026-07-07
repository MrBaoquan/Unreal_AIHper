"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WeightedRandom = void 0;
class WeightedRandom {
    static pick(entries, random = Math.random) {
        const normalized = this.normalize(entries);
        const totalWeight = normalized.reduce((total, entry) => total + entry.weight, 0);
        let cursor = this.clampRandom(random()) * totalWeight;
        for (const entry of normalized) {
            cursor -= entry.weight;
            if (cursor <= 0) {
                return entry.value;
            }
        }
        return normalized[normalized.length - 1].value;
    }
    static pickMany(entries, count, random = Math.random) {
        if (count <= 0) {
            return [];
        }
        const pool = this.normalize(entries).map((entry) => ({ ...entry }));
        const result = [];
        while (pool.length > 0 && result.length < count) {
            const value = this.pick(pool, random);
            result.push(value);
            const index = pool.findIndex((entry) => Object.is(entry.value, value));
            if (index >= 0) {
                pool.splice(index, 1);
            }
        }
        return result;
    }
    static normalize(entries) {
        const normalized = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
        if (normalized.length === 0) {
            throw new Error('WeightedRandom requires at least one entry with a positive finite weight');
        }
        return normalized;
    }
    static clampRandom(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        if (value <= 0) {
            return 0;
        }
        if (value >= 1) {
            return 0.999999999999;
        }
        return value;
    }
}
exports.WeightedRandom = WeightedRandom;
//# sourceMappingURL=WeightedRandom.js.map