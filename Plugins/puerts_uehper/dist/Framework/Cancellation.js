"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationTokenSource = exports.CancellationToken = exports.OperationCanceledError = void 0;
class OperationCanceledError extends Error {
    constructor(reason) {
        super(reason instanceof Error ? reason.message : reason || 'Operation canceled.');
        this.reason = reason;
        this.name = 'OperationCanceledError';
    }
}
exports.OperationCanceledError = OperationCanceledError;
class CancellationToken {
    constructor() {
        this.listeners = [];
        this.canceled = false;
    }
    get isCancellationRequested() {
        return this.canceled;
    }
    get reason() {
        return this.cancelReason;
    }
    throwIfCancellationRequested() {
        if (this.canceled) {
            throw new OperationCanceledError(this.cancelReason);
        }
    }
    onCancellationRequested(listener) {
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
    cancel(reason) {
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
exports.CancellationToken = CancellationToken;
class CancellationTokenSource {
    constructor() {
        this.token = new CancellationToken();
    }
    cancel(reason) {
        this.token.cancel(reason);
    }
    dispose() {
        this.token.cancel('CancellationTokenSource disposed.');
    }
}
exports.CancellationTokenSource = CancellationTokenSource;
//# sourceMappingURL=Cancellation.js.map