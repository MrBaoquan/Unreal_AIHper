"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandBus = void 0;
class CommandBus {
    constructor() {
        this.handlers = new Map();
    }
    register(commandName, handler) {
        if (this.handlers.has(commandName)) {
            throw new Error(`Command already registered: ${commandName}`);
        }
        this.handlers.set(commandName, handler);
    }
    unregister(commandName) {
        this.handlers.delete(commandName);
    }
    has(commandName) {
        return this.handlers.has(commandName);
    }
    async execute(commandName, payload) {
        const handler = this.handlers.get(commandName);
        if (!handler) {
            throw new Error(`Command not registered: ${commandName}`);
        }
        return (await handler(payload));
    }
    clear() {
        this.handlers.clear();
    }
    dispose() {
        this.clear();
    }
}
exports.CommandBus = CommandBus;
//# sourceMappingURL=CommandBus.js.map