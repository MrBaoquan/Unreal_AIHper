export type StateId = string;

export interface StateTransition<TContext = unknown> {
    readonly from: StateId;
    readonly to: StateId;
    readonly reason?: string;
    readonly context?: TContext;
}

export interface StateDefinition<TContext = unknown> {
    readonly id: StateId;
    readonly canEnter?: (transition: StateTransition<TContext>) => boolean;
    readonly onEnter?: (transition: StateTransition<TContext>) => void | Promise<void>;
    readonly onExit?: (transition: StateTransition<TContext>) => void | Promise<void>;
}

export interface GameStateMachineOptions<TContext = unknown> {
    readonly initialState: StateId;
    readonly states: readonly StateDefinition<TContext>[];
    readonly allowedTransitions?: Record<string, readonly string[]>;
}

export class GameStateMachine<TContext = unknown> {
    private readonly states = new Map<StateId, StateDefinition<TContext>>();
    private readonly allowedTransitions?: Record<string, readonly string[]>;
    private currentState: StateId;
    private transitioning = false;

    constructor(options: GameStateMachineOptions<TContext>) {
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

    get state(): StateId {
        return this.currentState;
    }

    canTransitionTo(nextState: StateId, context?: TContext): boolean {
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
        const transition: StateTransition<TContext> = { from: this.currentState, to: nextState, context };
        return this.states.get(nextState)?.canEnter?.(transition) !== false;
    }

    async transitionTo(nextState: StateId, reason?: string, context?: TContext): Promise<StateTransition<TContext>> {
        if (this.transitioning) {
            throw new Error(`State transition already in progress: ${this.currentState} -> ${nextState}`);
        }
        if (!this.canTransitionTo(nextState, context)) {
            throw new Error(`State transition is not allowed: ${this.currentState} -> ${nextState}`);
        }

        const transition: StateTransition<TContext> = { from: this.currentState, to: nextState, reason, context };
        if (this.currentState === nextState) {
            return transition;
        }

        this.transitioning = true;
        try {
            await this.states.get(this.currentState)?.onExit?.(transition);
            this.currentState = nextState;
            await this.states.get(nextState)?.onEnter?.(transition);
            return transition;
        } finally {
            this.transitioning = false;
        }
    }
}