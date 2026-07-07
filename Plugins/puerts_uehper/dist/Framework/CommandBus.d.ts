export type CommandHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => TResult | Promise<TResult>;
export declare class CommandBus {
    private readonly handlers;
    register<TPayload = unknown, TResult = unknown>(commandName: string, handler: CommandHandler<TPayload, TResult>): void;
    unregister(commandName: string): void;
    has(commandName: string): boolean;
    execute<TPayload = unknown, TResult = unknown>(commandName: string, payload: TPayload): Promise<TResult>;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=CommandBus.d.ts.map