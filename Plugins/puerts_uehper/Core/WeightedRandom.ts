export interface WeightedRandomEntry<T> {
    readonly value: T;
    readonly weight: number;
}

export type RandomSource = () => number;

export class WeightedRandom {
    static pick<T>(entries: readonly WeightedRandomEntry<T>[], random: RandomSource = Math.random): T {
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

    static pickMany<T>(entries: readonly WeightedRandomEntry<T>[], count: number, random: RandomSource = Math.random): T[] {
        if (count <= 0) {
            return [];
        }

        const pool = this.normalize(entries).map((entry) => ({ ...entry }));
        const result: T[] = [];
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

    static normalize<T>(entries: readonly WeightedRandomEntry<T>[]): WeightedRandomEntry<T>[] {
        const normalized = entries.filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0);
        if (normalized.length === 0) {
            throw new Error('WeightedRandom requires at least one entry with a positive finite weight');
        }
        return normalized;
    }

    private static clampRandom(value: number): number {
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