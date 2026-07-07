export interface WeightedRandomEntry<T> {
    readonly value: T;
    readonly weight: number;
}
export type RandomSource = () => number;
export declare class WeightedRandom {
    static pick<T>(entries: readonly WeightedRandomEntry<T>[], random?: RandomSource): T;
    static pickMany<T>(entries: readonly WeightedRandomEntry<T>[], count: number, random?: RandomSource): T[];
    static normalize<T>(entries: readonly WeightedRandomEntry<T>[]): WeightedRandomEntry<T>[];
    private static clampRandom;
}
//# sourceMappingURL=WeightedRandom.d.ts.map