"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGameplayEvent = void 0;
let nextGameplayEventId = 1;
function createGameplayEvent(options) {
    return {
        ...options,
        eventId: options.eventId ?? `gameplay:event:${nextGameplayEventId++}`,
        timeSeconds: options.timeSeconds ?? Date.now() / 1000,
    };
}
exports.createGameplayEvent = createGameplayEvent;
//# sourceMappingURL=GameplayEventEnvelope.js.map