export type CancellationReason = string | Error | undefined;
export type CancellationListener = (reason: CancellationReason) => void;
export declare class OperationCanceledError extends Error {
    readonly reason?: CancellationReason;
    constructor(reason?: CancellationReason);
}
export declare class CancellationToken {
    private listeners;
    private canceled;
    private cancelReason;
    get isCancellationRequested(): boolean;
    get reason(): CancellationReason;
    throwIfCancellationRequested(): void;
    onCancellationRequested(listener: CancellationListener): () => void;
    cancel(reason?: CancellationReason): void;
}
export declare class CancellationTokenSource {
    readonly token: CancellationToken;
    cancel(reason?: CancellationReason): void;
    dispose(): void;
}
//# sourceMappingURL=Cancellation.d.ts.map