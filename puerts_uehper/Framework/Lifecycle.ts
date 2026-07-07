export interface FrameworkAppOptions {
    runtimeSubsystem?: unknown;
    entryModule: string;
}

export interface UEHperWorldContextInfo {
    WorldId?: string;
    WorldName?: string;
    WorldType?: string;
    bIsPIE?: boolean;
    PIEInstanceId?: number;
    bHasAuthority?: boolean;
}

export interface UEHperNetworkFailureInfo {
    WorldContextInfo?: UEHperWorldContextInfo;
    FailureType?: string;
    ErrorString?: string;
}

export interface WorldContextInfo {
    id: string;
    name?: string;
    type?: string;
    isPIE?: boolean;
    pieInstanceId?: number;
    hasAuthority?: boolean;
    world?: unknown;
}

export interface GameApp {
    /**
     * Root scope 初始化。仅在 FrameworkApp.initialize 阶段被调用一次。
     * 传入的 context 只暴露 root services（events/commands/resources）。
     * 推荐用于资源 manifest、preloadGroups、root scoped 配置注入。
     */
    initializeRoot?(rootContext: FrameworkContext): Promise<void> | void;
    /**
     * World scope 初始化。每个 World 创建时调用一次，可访问完整服务图。
     * 推荐用于 ui/scenes manifest 注入、modules 注册与 initializeAll。
     */
    initializeWorld?(context: FrameworkContext): Promise<void> | void;
    /**
     * @deprecated 旧版 World 初始化入口；新代码请实现 `initializeWorld`。
     * 当 `initializeWorld` 未实现时，框架会回退调用 `initialize` 以保持兼容。
     */
    initialize?(context: FrameworkContext): Promise<void> | void;
    start?(): Promise<void> | void;
    stop?(): Promise<void> | void;
    dispose?(): Promise<void> | void;
    onWorldInitialized?(context: FrameworkContext): Promise<void> | void;
    onWorldBeginPlay?(context: FrameworkContext): Promise<void> | void;
    onWorldCleanup?(context: FrameworkContext): Promise<void> | void;
    onNetworkFailure?(context: FrameworkContext | undefined, failure: UEHperNetworkFailureInfo): Promise<void> | void;
    /**
     * Stage 6.19：当 `createWorldContext` 在 `initializeWorld`/`initialize`/`services.initializeAll` 阶段抛错时被调用，
     * 仅用于项目层日志聚合或上报；不必释放资源——框架在调用 hook 之后会执行完整的 `destroyWorldContext`。
     * hook 自身的异常会被框架捕获并 `console.warn`，不会掩盖原始错误。
     */
    onWorldInitFailed?(context: FrameworkContext, error: unknown): Promise<void> | void;
}

export interface GameModule {
    readonly name: string;
    readonly dependencies?: string[];
    initialize(context: FrameworkContext): Promise<void> | void;
    start?(): Promise<void> | void;
    stop?(): Promise<void> | void;
    dispose?(): Promise<void> | void;
}

export interface FrameworkContext {
    readonly id: string;
    readonly world?: unknown;
    readonly services: import('./ServiceRegistry').ServiceRegistry;
    readonly rootServices: import('./ServiceRegistry').ServiceRegistry;
    readonly logger: FrameworkLogger;
    getService<T = unknown>(name: string): T;
    getLocalService<T = unknown>(name: string): T | undefined;
    beginPlay(): Promise<void>;
    dispose(): Promise<void>;
}

export interface FrameworkLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
