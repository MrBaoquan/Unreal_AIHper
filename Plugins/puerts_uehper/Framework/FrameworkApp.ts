import { FrameworkAppOptions, GameApp, UEHperNetworkFailureInfo, UEHperWorldContextInfo, WorldContextInfo } from './Lifecycle';
import * as UE from 'ue';
import { CommandBus } from './CommandBus';
import { DEFAULT_SERVICES, DefaultServiceGraph, findDefaultServiceMeta } from './DefaultServices';
import { EventBus, ScopedEventBus } from './EventBus';
import { FrameworkContext } from './FrameworkContext';
import { ModuleRegistry } from './ModuleRegistry';
import { ServiceRegistry } from './ServiceRegistry';
import { PlayerInputService } from '../Services/PlayerInputService';
import { ResourceFacade, ResourceService } from '../Services/ResourceService';
import { SaveGameService } from '../Services/SaveGameService';
import { SceneService } from '../Services/SceneService';
import { TimerService } from '../Services/TimerService';
import { UIService } from '../Services/UIService';

declare const require: (moduleName: string) => any;

export class FrameworkApp {
    private readonly contexts = new Map<string, FrameworkContext>();
    private readonly rootServices = new ServiceRegistry();
    // P0-A: root-scoped ModuleRegistry，承载跨 World 持久的 Module（如 SessionModule）。
    // 与 world-scoped ModuleRegistry 区分：rootModules 在 initialize 阶段启动，shutdown 阶段销毁，
    // World 重建（destroyWorldContext）不影响 rootModules。
    private readonly rootModules = new ModuleRegistry();
    private projectApp?: GameApp;
    private options?: FrameworkAppOptions;
    private rootContext?: FrameworkContext;
    private started = false;

    async initialize(options: FrameworkAppOptions): Promise<void> {
        this.options = options;
        this.registerDefaultServices();
        this.projectApp = this.loadProjectApp(options.entryModule);

        // P0-A: 暴露 FrameworkApp 引用供 ConfiguredProjectGameApp.initializeRoot 注册 rootModules。
        // 在 shutdown 中清空，避免全局泄漏。
        (globalThis as { __uehperFrameworkApp?: FrameworkApp }).__uehperFrameworkApp = this;

        this.rootContext = this.createRootContext();
        if (this.projectApp?.initializeRoot) {
            await this.projectApp.initializeRoot(this.rootContext);
        }
        // Stage 6.15: 显式触发 root scope 服务的 initialize lifecycle，激活 Stage 6.14 的 best-effort 回滚链路。
        // 默认 root 服务（events/commands/resources）未声明 'initialize'，此调用对它们是 no-op；项目自定义服务
        // 可通过 lifecycle: ['register','initialize','dispose'] 主动接入。
        await this.rootServices.initializeAll(this.rootContext);
        // P0-A: root-scoped Module 的 initialize/start 在 root services 就绪后执行，
        // 保证 SessionModule 等跨 World 持久模块可在 rootContext 注册服务并订阅全局事件。
        await this.rootModules.initializeAll(this.rootContext);
        await this.rootModules.startAll();
        if (this.projectApp?.start) {
            await this.projectApp.start();
            this.started = true;
        }
        console.log(`[uehper] FrameworkApp initialized. entryModule=${options.entryModule}`);
    }

    async notifyWorldInitialized(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<FrameworkContext> {
        const context = await this.createWorldContext(this.toWorldContextInfo(world, nativeInfo));
        await this.projectApp?.onWorldInitialized?.(context);
        return context;
    }

    async notifyWorldBeginPlay(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<FrameworkContext> {
        const context = await this.createWorldContext(this.toWorldContextInfo(world, nativeInfo));
        await context.beginPlay();
        await this.projectApp?.onWorldBeginPlay?.(context);
        return context;
    }

    notifyWorldTick(world: unknown, nativeInfo: UEHperWorldContextInfo, deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
            return;
        }

        const worldInfo = this.toWorldContextInfo(world, nativeInfo);
        const context = this.contexts.get(worldInfo.id);
        const timers = context?.getLocalService<{ update?: (dt: number) => void }>('timers');
        if (typeof timers?.update === 'function') {
            timers.update(deltaSeconds);
        }
    }

    async notifyWorldCleanup(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<void> {
        const worldInfo = this.toWorldContextInfo(world, nativeInfo);
        const context = this.contexts.get(worldInfo.id);
        if (context) {
            await this.projectApp?.onWorldCleanup?.(context);
        }

        await this.destroyWorldContext(worldInfo.id);
    }

    async notifyNetworkFailure(world: unknown, failure: UEHperNetworkFailureInfo): Promise<void> {
        const worldId = failure.WorldContextInfo?.WorldId;
        const context = worldId ? this.contexts.get(worldId) : undefined;
        await this.projectApp?.onNetworkFailure?.(context, failure);
    }

    async createWorldContext(worldInfo: WorldContextInfo): Promise<FrameworkContext> {
        const existing = this.contexts.get(worldInfo.id);
        if (existing) {
            return existing;
        }

        const context = new FrameworkContext(worldInfo, this.createWorldServices(worldInfo.world), true);
        this.contexts.set(context.id, context);

        try {
            if (this.projectApp) {
                if (this.projectApp.initializeWorld) {
                    await this.projectApp.initializeWorld(context);
                } else if (this.projectApp.initialize) {
                    // Legacy path: 旧版 GameApp 把 root + world 初始化都塞在 initialize 中。
                    await this.projectApp.initialize(context);
                }
            }

            // Stage 6.15: projectApp.initializeWorld 之后再触发 world scope 服务的 initialize lifecycle，
            // 这样项目在 initializeWorld 中追加的 lifecycle 服务也能纳入回滚链路。
            await context.services.initializeAll(context);
        } catch (error) {
            // Stage 6.16: 任一阶段失败都要完整拆解 world context，避免遗留半初始化状态；随后重抛，
            // 由 C++ NotifyWorldInitialized/BeginPlay 调用方决定是否升级为 RuntimeState=Failed。
            console.warn(`[uehper] createWorldContext failed for ${context.id}; rolling back. ${(error as Error)?.stack ?? error}`);
            // Stage 6.19: 调用项目层可选 onWorldInitFailed hook（仅日志/上报用途，不释放资源）。
            if (this.projectApp?.onWorldInitFailed) {
                try {
                    await this.projectApp.onWorldInitFailed(context, error);
                } catch (hookError) {
                    console.warn(`[uehper] projectApp.onWorldInitFailed threw; ignoring. ${(hookError as Error)?.stack ?? hookError}`);
                }
            }
            try {
                await this.destroyWorldContext(context.id);
            } catch (rollbackError) {
                console.warn(`[uehper] createWorldContext rollback destroyWorldContext failed: ${context.id}. ${(rollbackError as Error)?.stack ?? rollbackError}`);
            }
            throw error;
        }

        return context;
    }

    async destroyWorldContext(worldId: string): Promise<void> {
        const context = this.contexts.get(worldId);
        if (!context) {
            return;
        }

        try {
            await context.services.disposeAll();
        } catch (error) {
            console.warn(`[uehper] World services.disposeAll failed: ${worldId}. ${(error as Error)?.stack ?? error}`);
        }
        await context.dispose();
        this.contexts.delete(worldId);
    }

    getContext(worldId: string): FrameworkContext | undefined {
        return this.contexts.get(worldId);
    }

    getRootContext(): FrameworkContext | undefined {
        return this.rootContext;
    }

    async shutdown(): Promise<void> {
        for (const worldId of Array.from(this.contexts.keys())) {
            await this.destroyWorldContext(worldId);
        }

        // P0-A: root-scoped Module 在所有 World 销毁后停止与释放，保证跨 World 持久模块的最后清理顺序。
        if (this.started) {
            await this.rootModules.stopAll();
        }
        await this.rootModules.disposeAll();

        if (this.started) {
            await this.projectApp?.stop?.();
            this.started = false;
        }
        await this.projectApp?.dispose?.();
        if (this.rootContext) {
            await this.rootContext.dispose();
            this.rootContext = undefined;
        }
        try {
            await this.rootServices.disposeAll();
        } catch (error) {
            console.warn(`[uehper] Root services.disposeAll failed. ${(error as Error)?.stack ?? error}`);
        }
        this.rootServices.clear();
        this.projectApp = undefined;
        this.options = undefined;
        // P0-A: 清理全局引用，避免 shutdown 后残留。
        delete (globalThis as { __uehperFrameworkApp?: FrameworkApp }).__uehperFrameworkApp;
        console.log('[uehper] FrameworkApp shutdown');
    }

    /** P0-A: 暴露 root-scoped ModuleRegistry，供项目层在 initializeRoot 阶段注册跨 World 持久模块。 */
    getRootModules(): ModuleRegistry {
        return this.rootModules;
    }

    private registerDefaultServices(): void {
        // Stage 6.17: lifecycle/dependencies 从 DEFAULT_SERVICES 读取，避免与 doctor.js 双源维护漂移。
        const meta = (name: string) => findDefaultServiceMeta('root', name)!;
        if (!this.rootServices.has('events')) {
            const m = meta('events');
            this.rootServices.register('events', new EventBus(), { dependencies: m.dependencies, lifecycle: m.lifecycle });
        }
        if (!this.rootServices.has('commands')) {
            const m = meta('commands');
            this.rootServices.register('commands', new CommandBus(), { dependencies: m.dependencies, lifecycle: m.lifecycle });
        }
        if (!this.rootServices.has('resources')) {
            const m = meta('resources');
            this.rootServices.register('resources', new ResourceService(), { dependencies: m.dependencies, lifecycle: m.lifecycle });
        }
    }

    /** Stage 6.17: 默认服务拓扑的单一数据源；doctor 直接读取避免漂移。 */
    static describeDefaultServices(): DefaultServiceGraph {
        return {
            root: DEFAULT_SERVICES.root.map((entry) => ({ ...entry, dependencies: [...entry.dependencies], lifecycle: [...entry.lifecycle] })),
            world: DEFAULT_SERVICES.world.map((entry) => ({ ...entry, dependencies: [...entry.dependencies], lifecycle: [...entry.lifecycle] })),
        };
    }

    private createRootContext(): FrameworkContext {
        // root context 不绑定具体 World，services 指向 rootServices，且 dispose 不清空（由 shutdown 统一处理）。
        return new FrameworkContext({ id: 'root' }, this.rootServices, false);
    }

    private createWorldServices(world: unknown): ServiceRegistry {
        const services = this.rootServices.createChild('world');
        const resources = this.rootServices.get<ResourceService>('resources');
        // Stage 6.17: lifecycle/dependencies 由 DEFAULT_SERVICES 驱动，与 doctor 保持一致。
        const meta = (name: string) => findDefaultServiceMeta('world', name)!;
        // World-scoped 事件门面：包裹 root 'events' 单例，覆盖（shadow）world 作用域的 'events'。
        // world 模块 getService('events') 解析到此门面；world 销毁时 services.disposeAll() 调用其
        // dispose() 一次性退订本 world 全部 handler，杜绝跨 world 残留订阅泄漏（emit 仍委托 root）。
        const rootEvents = this.rootServices.get<EventBus>('events');
        const mEvents = meta('events');
        services.register('events', new ScopedEventBus(rootEvents), { dependencies: mEvents.dependencies, lifecycle: mEvents.lifecycle });
        const mPlayerInput = meta('playerInput');
        const playerInput = services.register('playerInput', new PlayerInputService(), { dependencies: mPlayerInput.dependencies, lifecycle: mPlayerInput.lifecycle });
        const mModules = meta('modules');
        services.register('modules', new ModuleRegistry(), { dependencies: mModules.dependencies, lifecycle: mModules.lifecycle });
        const mTimers = meta('timers');
        services.register('timers', new TimerService(), { dependencies: mTimers.dependencies, lifecycle: mTimers.lifecycle });
        // 注意：actorRegistry / playerRegistry 两项为多人能力包，
        // 已从默认 World 图降级；由 registerMultiplayerCapabilityPack(services, world) 按需装入，
        // 业务项目通过 ProjectConfig.multiplayer = true 在 initializeWorld 阶段装配。
        const mSaveGames = meta('saveGames');
        services.register('saveGames', new SaveGameService(world as UE.Object), { dependencies: mSaveGames.dependencies, lifecycle: mSaveGames.lifecycle });
        const mScenes = meta('scenes');
        services.register('scenes', new SceneService(world as UE.Object), { dependencies: mScenes.dependencies, lifecycle: mScenes.lifecycle });
        const mWorldResources = meta('worldResources');
        const worldResources = services.register('worldResources', new ResourceFacade(resources, world as UE.Object), {
            dependencies: mWorldResources.dependencies,
            lifecycle: mWorldResources.lifecycle,
        });
        const mUi = meta('ui');
        services.register('ui', new UIService(worldResources, playerInput), {
            dependencies: mUi.dependencies,
            lifecycle: mUi.lifecycle,
        });
        return services;
    }

    private toWorldContextInfo(world: unknown, nativeInfo: UEHperWorldContextInfo): WorldContextInfo {
        const id = nativeInfo.WorldId || 'world';
        return {
            id,
            name: nativeInfo.WorldName,
            type: nativeInfo.WorldType,
            isPIE: nativeInfo.bIsPIE,
            pieInstanceId: nativeInfo.PIEInstanceId,
            hasAuthority: nativeInfo.bHasAuthority ?? true,
            world,
        };
    }

    private loadProjectApp(entryModule: string): GameApp | undefined {
        try {
            const moduleExports = require(entryModule);
            const appExport = moduleExports.default ?? moduleExports.ProjectGameApp ?? moduleExports.GameApp;
            if (!appExport) {
                console.warn(`[uehper] Project entry module has no default GameApp export: ${entryModule}`);
                return undefined;
            }

            if (typeof appExport === 'function') {
                return new appExport() as GameApp;
            }

            return appExport as GameApp;
        } catch (error) {
            console.warn(`[uehper] Project GameApp not loaded: ${entryModule}. ${error}`);
            return undefined;
        }
    }
}
