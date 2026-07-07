"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkStartupError = void 0;
class FrameworkStartupError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FrameworkStartupError';
    }
}
exports.FrameworkStartupError = FrameworkStartupError;
//# sourceMappingURL=Errors.js.map