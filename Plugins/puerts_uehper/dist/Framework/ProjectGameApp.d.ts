import { type GameModuleRegistration } from './ModuleRegistry';
import type { FrameworkContext, GameApp } from './Lifecycle';
import { type ResourceManifest, type ResourcePreloadGroups } from '../Services/ResourceService';
import { type SceneManifest } from '../Services/SceneService';
import { type UIManifest } from '../Services/UIService';
export interface ProjectConfig {
    resourceManifest?: ResourceManifest;
    resourcePreloadGroups?: ResourcePreloadGroups;
    sceneManifest?: SceneManifest;
    uiManifest?: UIManifest;
    modules?: GameModuleRegistration[];
    /** P0-A: root-scoped 模块，跨 World 持久，在 initializeRoot 阶段注册并启动。 */
    rootModules?: GameModuleRegistration[];
    /**
     * 是否启用多人能力包（actorRegistry / playerRegistry）。
     *
     * 默认 false：核心腰带不含多人协同所需服务，单人/非联网项目接入框架不会被强加预留接口位。
     * 设 true：在 initializeWorld 阶段 modules.initializeAll 之前调用
     * registerMultiplayerCapabilityPack(services, world) 装入三项服务，确保多人 Module
     * 通过 getService('playerRegistry') 等正常解析。
     */
    multiplayer?: boolean;
}
export declare class ConfiguredProjectGameApp implements GameApp {
    private readonly config;
    constructor(config?: ProjectConfig);
    initializeRoot(rootContext: FrameworkContext): Promise<void>;
    initializeWorld(context: FrameworkContext): Promise<void>;
    onWorldBeginPlay(context: FrameworkContext): Promise<void>;
    onWorldCleanup(context: FrameworkContext): Promise<void>;
}
export declare function createProjectGameApp(config?: ProjectConfig): GameApp;
//# sourceMappingURL=ProjectGameApp.d.ts.map