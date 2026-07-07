import { ModuleRegistry, type GameModuleRegistration } from './ModuleRegistry';
import type { FrameworkContext, GameApp } from './Lifecycle';
import { ResourceService, type ResourceManifest, type ResourcePreloadGroups } from '../Services/ResourceService';
import { SceneService, type SceneManifest } from '../Services/SceneService';
import { UIService, type UIManifest } from '../Services/UIService';
import { registerMultiplayerCapabilityPack } from '../Multiplayer/CapabilityPack';

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

export class ConfiguredProjectGameApp implements GameApp {
    constructor(private readonly config: ProjectConfig = {}) {}

    async initializeRoot(rootContext: FrameworkContext): Promise<void> {
        const resources = rootContext.services.get<ResourceService>('resources');
        resources.setManifest(this.config.resourceManifest ?? {});
        resources.setPreloadGroups(this.config.resourcePreloadGroups ?? {});

        // P0-A: 注册 root-scoped 模块。框架 FrameworkApp 会在 rootServices.initializeAll 之后
        // 调用 rootModules.initializeAll + startAll，此处只需 registerMany。
        // rootModules 通过 rootContext.getService 访问 root services（events/commands/resources），
        // 并可注册自己的 root-scoped 服务供 World 层通过 context.rootServices.getService 消费。
        const frameworkApp = (globalThis as { __uehperFrameworkApp?: { getRootModules(): ModuleRegistry } }).__uehperFrameworkApp;
        if (frameworkApp && this.config.rootModules && this.config.rootModules.length > 0) {
            const rootModules = frameworkApp.getRootModules();
            rootModules.registerMany(this.config.rootModules);
            rootContext.logger.info(`GameApp root initialized with ${this.config.rootModules.length} root modules`);
        } else {
            rootContext.logger.info('GameApp root initialized');
        }
    }

    async initializeWorld(context: FrameworkContext): Promise<void> {
        // 多人能力包先于模块装配：modules.initializeAll 内的多人 Module 会 getService('playerRegistry') 等，
        // 若不在装模块前注册，会因服务缺失而失败。opt-in 由 ProjectConfig.multiplayer 开关决定。
        if (this.config.multiplayer === true) {
            registerMultiplayerCapabilityPack(context.services, context.world);
            context.logger.info('GameApp multiplayer capability pack installed');
        }

        context.services.get<UIService>('ui').setManifest(this.config.uiManifest ?? {});
        context.services.get<SceneService>('scenes').setManifest(this.config.sceneManifest ?? {});

        const modules = context.services.get<ModuleRegistry>('modules');
        modules.registerMany(this.config.modules ?? []);
        await modules.initializeAll(context);
        context.logger.info('GameApp started');
    }

    async onWorldBeginPlay(context: FrameworkContext): Promise<void> {
        await context.services.get<ModuleRegistry>('modules').startAll();
    }

    async onWorldCleanup(context: FrameworkContext): Promise<void> {
        const modules = context.services.get<ModuleRegistry>('modules');
        await modules.stopAll();
        await modules.disposeAll();
        context.services.get<UIService>('ui').releaseAll();
    }
}

export function createProjectGameApp(config: ProjectConfig = {}): GameApp {
    return new ConfiguredProjectGameApp(config);
}
