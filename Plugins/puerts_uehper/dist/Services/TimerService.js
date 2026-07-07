"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimerService = void 0;
class TimerService {
    constructor() {
        this.timers = new Map();
        this.nextId = 1;
    }
    createTimer(options) {
        if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
            throw new Error('TimerService.createTimer requires durationSeconds > 0');
        }
        const id = options.id ?? `timer:${this.nextId++}`;
        if (this.timers.has(id)) {
            throw new Error(`Timer already exists: ${id}`);
        }
        const record = {
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
    delay(durationSeconds, onComplete, id) {
        return this.createTimer({ id, durationSeconds, onComplete });
    }
    every(durationSeconds, onTick, id) {
        return this.createTimer({ id, durationSeconds, loop: true, onComplete: onTick });
    }
    start(id) {
        const record = this.requireTimer(id);
        record.active = true;
    }
    pause(id) {
        const record = this.requireTimer(id);
        record.active = false;
    }
    cancel(id) {
        return this.timers.delete(id);
    }
    update(deltaSeconds) {
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
    getInfo(id) {
        const record = this.timers.get(id);
        return record ? this.toInfo(record) : undefined;
    }
    clear() {
        this.timers.clear();
    }
    dispose() {
        this.clear();
    }
    requireTimer(id) {
        const record = this.timers.get(id);
        if (!record) {
            throw new Error(`Timer not found: ${id}`);
        }
        return record;
    }
    toInfo(record) {
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
exports.TimerService = TimerService;
//# sourceMappingURL=TimerService.js.map