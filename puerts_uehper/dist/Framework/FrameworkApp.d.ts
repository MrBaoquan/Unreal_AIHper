import { FrameworkAppOptions, UEHperNetworkFailureInfo, UEHperWorldContextInfo, WorldContextInfo } from './Lifecycle';
import { DefaultServiceGraph } from './DefaultServices';
import { FrameworkContext } from './FrameworkContext';
import { ModuleRegistry } from './ModuleRegistry';
export declare class FrameworkApp {
    private readonly contexts;
    private readonly rootServices;
    private readonly rootModules;
    private projectApp?;
    private options?;
    private rootContext?;
    private started;
    initialize(options: FrameworkAppOptions): Promise<void>;
    notifyWorldInitialized(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<FrameworkContext>;
    notifyWorldBeginPlay(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<FrameworkContext>;
    notifyWorldTick(world: unknown, nativeInfo: UEHperWorldContextInfo, deltaSeconds: number): void;
    notifyWorldCleanup(world: unknown, nativeInfo: UEHperWorldContextInfo): Promise<void>;
    notifyNetworkFailure(world: unknown, failure: UEHperNetworkFailureInfo): Promise<void>;
    createWorldContext(worldInfo: WorldContextInfo): Promise<FrameworkContext>;
    destroyWorldContext(worldId: string): Promise<void>;
    getContext(worldId: string): FrameworkContext | undefined;
    getRootContext(): FrameworkContext | undefined;
    shutdown(): Promise<void>;
    /** P0-A: 暴露 root-scoped ModuleRegistry，供项目层在 initializeRoot 阶段注册跨 World 持久模块。 */
    getRootModules(): ModuleRegistry;
    private registerDefaultServices;
    /** Stage 6.17: 默认服务拓扑的单一数据源；doctor 直接读取避免漂移。 */
    static describeDefaultServices(): DefaultServiceGraph;
    private createRootContext;
    private createWorldServices;
    private toWorldContextInfo;
    private loadProjectApp;
}
//# sourceMappingURL=FrameworkApp.d.ts.map