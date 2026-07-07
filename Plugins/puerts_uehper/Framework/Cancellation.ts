export type CancellationReason = string | Error | undefined;
export type CancellationListener = (reason: CancellationReason) => void;

export class OperationCanceledError extends Error {
    constructor(readonly reason?: CancellationReason) {
        super(reason instanceof Error ? reason.message : reason || 'Operation canceled.');
        this.name = 'OperationCanceledError';
    }
}

export class CancellationToken {
    private listeners: CancellationListener[] = [];
    private canceled = false;
    private cancelReason: CancellationReason;

    get isCancellationRequested(): boolean {
        return this.canceled;
    }

    get reason(): CancellationReason {
        return this.cancelReason;
    }

    throwIfCancellationRequested(): void {
        if (this.canceled) {
            throw new OperationCanceledError(this.cancelReason);
        }
    }

    onCancellationRequested(listener: CancellationListener): () => void {
        if (this.canceled) {
            listener(this.cancelReason);
            return () => undefined;
        }

        this.listeners.push(listener);
        return () => {
            const index = this.listeners.indexOf(listener);
            if (index >= 0) {
                this.listeners.splice(index, 1);
            }
        };
    }

    cancel(reason?: CancellationReason): void {
        if (this.canceled) {
            return;
        }

        this.canceled = true;
        this.cancelReason = reason;
        const listeners = [...this.listeners];
        this.listeners.length = 0;
        for (const listener of listeners) {
            listener(reason);
        }
    }
}

export class CancellationTokenSource {
    readonly token = new CancellationToken();

    cancel(reason?: CancellationReason): void {
        this.token.cancel(reason);
    }

    dispose(): void {
        this.token.cancel('CancellationTokenSource disposed.');
    }
}
