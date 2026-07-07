"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleRegistry = void 0;
class ModuleRegistry {
    constructor() {
        this.modules = new Map();
    }
    register(moduleRegistration) {
        const moduleInstance = typeof moduleRegistration === 'function' ? new moduleRegistration() : moduleRegistration;
        if (this.modules.has(moduleInstance.name)) {
            throw new Error(`Module already registered: ${moduleInstance.name}`);
        }
        this.modules.set(moduleInstance.name, moduleInstance);
        return moduleInstance;
    }
    registerMany(moduleRegistrations) {
        for (const moduleRegistration of moduleRegistrations) {
            this.register(moduleRegistration);
        }
    }
    get(name) {
        return this.modules.get(name);
    }
    getAll() {
        return Array.from(this.modules.values());
    }
    async initializeAll(context) {
        for (const moduleInstance of this.getAll()) {
            await moduleInstance.initialize(context);
        }
    }
    async startAll() {
        for (const moduleInstance of this.getAll()) {
            await moduleInstance.start?.();
        }
    }
    async stopAll() {
        for (const moduleInstance of Array.from(this.getAll()).reverse()) {
            await moduleInstance.stop?.();
        }
    }
    async disposeAll() {
        for (const moduleInstance of Array.from(this.getAll()).reverse()) {
            await moduleInstance.dispose?.();
        }
        this.modules.clear();
    }
}
exports.ModuleRegistry = ModuleRegistry;
//# sourceMappingURL=ModuleRegistry.js.map