import type { FrameworkContext, GameModule } from './Lifecycle';

export type GameModuleConstructor = new () => GameModule;
export type GameModuleRegistration = GameModule | GameModuleConstructor;

export class ModuleRegistry {
    private readonly modules = new Map<string, GameModule>();

    register(moduleRegistration: GameModuleRegistration): GameModule {
        const moduleInstance = typeof moduleRegistration === 'function' ? new moduleRegistration() : moduleRegistration;
        if (this.modules.has(moduleInstance.name)) {
            throw new Error(`Module already registered: ${moduleInstance.name}`);
        }

        this.modules.set(moduleInstance.name, moduleInstance);
        return moduleInstance;
    }

    registerMany(moduleRegistrations: GameModuleRegistration[]): void {
        for (const moduleRegistration of moduleRegistrations) {
            this.register(moduleRegistration);
        }
    }

    get(name: string): GameModule | undefined {
        return this.modules.get(name);
    }

    getAll(): GameModule[] {
        return Array.from(this.modules.values());
    }

    async initializeAll(context: FrameworkContext): Promise<void> {
        for (const moduleInstance of this.getAll()) {
            await moduleInstance.initialize(context);
        }
    }

    async startAll(): Promise<void> {
        for (const moduleInstance of this.getAll()) {
            await moduleInstance.start?.();
        }
    }

    async stopAll(): Promise<void> {
        for (const moduleInstance of Array.from(this.getAll()).reverse()) {
            await moduleInstance.stop?.();
        }
    }

    async disposeAll(): Promise<void> {
        for (const moduleInstance of Array.from(this.getAll()).reverse()) {
            await moduleInstance.dispose?.();
        }

        this.modules.clear();
    }
}
