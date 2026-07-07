import type { FrameworkContext, GameModule } from './Lifecycle';
export type GameModuleConstructor = new () => GameModule;
export type GameModuleRegistration = GameModule | GameModuleConstructor;
export declare class ModuleRegistry {
    private readonly modules;
    register(moduleRegistration: GameModuleRegistration): GameModule;
    registerMany(moduleRegistrations: GameModuleRegistration[]): void;
    get(name: string): GameModule | undefined;
    getAll(): GameModule[];
    initializeAll(context: FrameworkContext): Promise<void>;
    startAll(): Promise<void>;
    stopAll(): Promise<void>;
    disposeAll(): Promise<void>;
}
//# sourceMappingURL=ModuleRegistry.d.ts.map