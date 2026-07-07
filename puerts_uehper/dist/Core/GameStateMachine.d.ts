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
export declare class GameStateMachine<TContext = unknown> {
    private readonly states;
    private readonly allowedTransitions?;
    private currentState;
    private transitioning;
    constructor(options: GameStateMachineOptions<TContext>);
    get state(): StateId;
    canTransitionTo(nextState: StateId, context?: TContext): boolean;
    transitionTo(nextState: StateId, reason?: string, context?: TContext): Promise<StateTransition<TContext>>;
}
//# sourceMappingURL=GameStateMachine.d.ts.map