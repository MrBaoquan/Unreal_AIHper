export type ServiceFactory<T = unknown> = () => T;
export type ServiceScopeName = 'root' | 'world' | 'player';
export type ServiceLifecyclePhase = 'register' | 'initialize' | 'start' | 'stop' | 'dispose';
export interface ServiceRegistrationOptions {
    dependencies?: string[];
    lifecycle?: ServiceLifecyclePhase[];
}
export interface ServiceMetadata {
    name: string;
    scopeName: ServiceScopeName;
    dependencies: string[];
    lifecycle: ServiceLifecyclePhase[];
}
export declare class ServiceRegistry {
    private readonly parent?;
    readonly scopeName: ServiceScopeName;
    private readonly services;
    private readonly factories;
    private readonly metadata;
    constructor(parent?: ServiceRegistry, scopeName?: ServiceScopeName);
    createChild(scopeName: ServiceScopeName): ServiceRegistry;
    getParent(): ServiceRegistry | undefined;
    getRoot(): ServiceRegistry;
    register<T>(name: string, service: T, options?: ServiceRegistrationOptions): T;
    registerFactory<T>(name: string, factory: ServiceFactory<T>, options?: ServiceRegistrationOptions): void;
    has(name: string): boolean;
    hasLocal(name: string): boolean;
    get<T = unknown>(name: string): T;
    getLocal<T = unknown>(name: string): T | undefined;
    getMetadata(name: string): ServiceMetadata | undefined;
    getLocalMetadata(): ServiceMetadata[];
    getAllMetadata(): ServiceMetadata[];
    /**
     * 按 `dependencies` 拓扑排序当前 scope 的本地服务。
     * - 跨 scope 依赖：只要 parent.has(name) 成立即视为已满足，不参与排序。
     * - 缺失依赖：抛出 `Missing dependency` 错误。
     * - 存在环：抛出 `Service dependency cycle` 错误，附环路径。
     */
    getInitializationOrder(): ServiceMetadata[];
    /**
     * 返回当前 scope 中所有本地依赖环（每个环以 name 数组表示，首尾不重复）。
     * 跨 scope 依赖不参与环检测（视为外部边界）。
     */
    detectCycles(): string[][];
    private detectCyclesIn;
    /**
     * 按拓扑序对所有声明了 `initialize` lifecycle 且实现 `initialize(context)` 的本地服务调用初始化。
     * 仅扫描当前 scope，跨 scope 服务（如 root.events）由其拥有者负责。
     */
    initializeAll(context: unknown): Promise<void>;
    /**
     * 反向拓扑序释放本地服务：仅处理 lifecycle 包含 'dispose' 且实现 dispose() 的服务。
     */
    disposeAll(): Promise<void>;
    clear(): void;
    private createMetadata;
}
//# sourceMappingURL=ServiceRegistry.d.ts.map