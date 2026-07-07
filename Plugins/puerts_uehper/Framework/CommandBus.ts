export type CommandHandler<TPayload = unknown, TResult = unknown> = (payload: TPayload) => TResult | Promise<TResult>;

export class CommandBus {
    private readonly handlers = new Map<string, CommandHandler>();

    register<TPayload = unknown, TResult = unknown>(commandName: string, handler: CommandHandler<TPayload, TResult>): void {
        if (this.handlers.has(commandName)) {
            throw new Error(`Command already registered: ${commandName}`);
        }

        this.handlers.set(commandName, handler as CommandHandler);
    }

    unregister(commandName: string): void {
        this.handlers.delete(commandName);
    }

    has(commandName: string): boolean {
        return this.handlers.has(commandName);
    }

    async execute<TPayload = unknown, TResult = unknown>(commandName: string, payload: TPayload): Promise<TResult> {
        const handler = this.handlers.get(commandName);
        if (!handler) {
            throw new Error(`Command not registered: ${commandName}`);
        }

        return (await handler(payload)) as TResult;
    }

    clear(): void {
        this.handlers.clear();
    }

    dispose(): void {
        this.clear();
    }
}
