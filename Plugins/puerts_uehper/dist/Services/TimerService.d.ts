export type TimerId = string;
export interface TimerTickInfo {
    readonly id: TimerId;
    readonly elapsedSeconds: number;
    readonly durationSeconds: number;
    readonly progress: number;
    readonly remainingSeconds: number;
}
export interface TimerOptions {
    readonly id?: TimerId;
    readonly durationSeconds: number;
    readonly loop?: boolean;
    readonly autoStart?: boolean;
    readonly onStart?: (info: TimerTickInfo) => void;
    readonly onTick?: (info: TimerTickInfo) => void;
    readonly onComplete?: (info: TimerTickInfo) => void;
}
export declare class TimerService {
    private readonly timers;
    private nextId;
    createTimer(options: TimerOptions): TimerId;
    delay(durationSeconds: number, onComplete: (info: TimerTickInfo) => void, id?: TimerId): TimerId;
    every(durationSeconds: number, onTick: (info: TimerTickInfo) => void, id?: TimerId): TimerId;
    start(id: TimerId): void;
    pause(id: TimerId): void;
    cancel(id: TimerId): boolean;
    update(deltaSeconds: number): void;
    getInfo(id: TimerId): TimerTickInfo | undefined;
    clear(): void;
    dispose(): void;
    private requireTimer;
    private toInfo;
}
//# sourceMappingURL=TimerService.d.ts.map