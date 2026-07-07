"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameStateMachine = void 0;
class GameStateMachine {
    constructor(options) {
        this.states = new Map();
        this.transitioning = false;
        for (const state of options.states) {
            if (this.states.has(state.id)) {
                throw new Error(`Duplicate state: ${state.id}`);
            }
            this.states.set(state.id, state);
        }
        if (!this.states.has(options.initialState)) {
            throw new Error(`Initial state is not registered: ${options.initialState}`);
        }
        this.currentState = options.initialState;
        this.allowedTransitions = options.allowedTransitions;
    }
    get state() {
        return this.currentState;
    }
    canTransitionTo(nextState, context) {
        if (!this.states.has(nextState)) {
            return false;
        }
        if (this.currentState === nextState) {
            return true;
        }
        const allowedTargets = this.allowedTransitions?.[this.currentState];
        if (allowedTargets && !allowedTargets.includes(nextState)) {
            return false;
        }
        const transition = { from: this.currentState, to: nextState, context };
        return this.states.get(nextState)?.canEnter?.(transition) !== false;
    }
    async transitionTo(nextState, reason, context) {
        if (this.transitioning) {
            throw new Error(`State transition already in progress: ${this.currentState} -> ${nextState}`);
        }
        if (!this.canTransitionTo(nextState, context)) {
            throw new Error(`State transition is not allowed: ${this.currentState} -> ${nextState}`);
        }
        const transition = { from: this.currentState, to: nextState, reason, context };
        if (this.currentState === nextState) {
            return transition;
        }
        this.transitioning = true;
        try {
            await this.states.get(this.currentState)?.onExit?.(transition);
            this.currentState = nextState;
            await this.states.get(nextState)?.onEnter?.(transition);
            return transition;
        }
        finally {
            this.transitioning = false;
        }
    }
}
exports.GameStateMachine = GameStateMachine;
//# sourceMappingURL=GameStateMachine.js.map