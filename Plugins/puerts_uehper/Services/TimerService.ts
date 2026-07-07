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

interface TimerRecord extends Required<Pick<TimerOptions, 'durationSeconds'>> {
    id: TimerId;
    elapsedSeconds: number;
    loop: boolean;
    active: boolean;
    started: boolean;
    onStart?: (info: TimerTickInfo) => void;
    onTick?: (info: TimerTickInfo) => void;
    onComplete?: (info: TimerTickInfo) => void;
}

export class TimerService {
    private readonly timers = new Map<TimerId, TimerRecord>();
    private nextId = 1;

    createTimer(options: TimerOptions): TimerId {
        if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
            throw new Error('TimerService.createTimer requires durationSeconds > 0');
        }

        const id = options.id ?? `timer:${this.nextId++}`;
        if (this.timers.has(id)) {
            throw new Error(`Timer already exists: ${id}`);
        }

        const record: TimerRecord = {
            id,
            durationSeconds: options.durationSeconds,
            elapsedSeconds: 0,
            loop: options.loop === true,
            active: options.autoStart !== false,
            started: false,
            onStart: options.onStart,
            onTick: options.onTick,
            onComplete: options.onComplete,
        };
        this.timers.set(id, record);
        return id;
    }

    delay(durationSeconds: number, onComplete: (info: TimerTickInfo) => void, id?: TimerId): TimerId {
        return this.createTimer({ id, durationSeconds, onComplete });
    }

    every(durationSeconds: number, onTick: (info: TimerTickInfo) => void, id?: TimerId): TimerId {
        return this.createTimer({ id, durationSeconds, loop: true, onComplete: onTick });
    }

    start(id: TimerId): void {
        const record = this.requireTimer(id);
        record.active = true;
    }

    pause(id: TimerId): void {
        const record = this.requireTimer(id);
        record.active = false;
    }

    cancel(id: TimerId): boolean {
        return this.timers.delete(id);
    }

    update(deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }

        for (const record of Array.from(this.timers.values())) {
            if (!record.active) {
                continue;
            }
            if (!record.started) {
                record.started = true;
                record.onStart?.(this.toInfo(record));
            }

            record.elapsedSeconds += deltaSeconds;
            record.onTick?.(this.toInfo(record));

            while (record.elapsedSeconds >= record.durationSeconds && this.timers.has(record.id)) {
                record.onComplete?.(this.toInfo(record));
                if (!record.loop) {
                    this.timers.delete(record.id);
                    break;
                }
                record.elapsedSeconds -= record.durationSeconds;
            }
        }
    }

    getInfo(id: TimerId): TimerTickInfo | undefined {
        const record = this.timers.get(id);
        return record ? this.toInfo(record) : undefined;
    }

    clear(): void {
        this.timers.clear();
    }

    dispose(): void {
        this.clear();
    }

    private requireTimer(id: TimerId): TimerRecord {
        const record = this.timers.get(id);
        if (!record) {
            throw new Error(`Timer not found: ${id}`);
        }
        return record;
    }

    private toInfo(record: TimerRecord): TimerTickInfo {
        const clampedElapsed = Math.min(record.elapsedSeconds, record.durationSeconds);
        return {
            id: record.id,
            elapsedSeconds: clampedElapsed,
            durationSeconds: record.durationSeconds,
            progress: clampedElapsed / record.durationSeconds,
            remainingSeconds: Math.max(0, record.durationSeconds - clampedElapsed),
        };
    }
}