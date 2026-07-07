export interface GameplayEventEnvelope<TPayload = unknown> {
    readonly eventId: string;
    readonly type: string;
    readonly payload: TPayload;
    readonly matchId?: string;
    readonly playerId?: number;
    readonly sourceId?: string;
    readonly targetId?: string;
    readonly tags?: readonly string[];
    readonly timeSeconds: number;
}

export interface CreateGameplayEventOptions<TPayload = unknown> extends Omit<GameplayEventEnvelope<TPayload>, 'eventId' | 'timeSeconds'> {
    readonly eventId?: string;
    readonly timeSeconds?: number;
}

let nextGameplayEventId = 1;

export function createGameplayEvent<TPayload = unknown>(options: CreateGameplayEventOptions<TPayload>): GameplayEventEnvelope<TPayload> {
    return {
        ...options,
        eventId: options.eventId ?? `gameplay:event:${nextGameplayEventId++}`,
        timeSeconds: options.timeSeconds ?? Date.now() / 1000,
    };
}