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

export class ServiceRegistry {
    private readonly services = new Map<string, unknown>();
    private readonly factories = new Map<string, ServiceFactory>();
    private readonly metadata = new Map<string, ServiceMetadata>();

    constructor(
        private readonly parent?: ServiceRegistry,
        readonly scopeName: ServiceScopeName = 'root',
    ) {}

    createChild(scopeName: ServiceScopeName): ServiceRegistry {
        return new ServiceRegistry(this, scopeName);
    }

    getParent(): ServiceRegistry | undefined {
        return this.parent;
    }

    getRoot(): ServiceRegistry {
        let current: ServiceRegistry = this;
        while (current.parent) {
            current = current.parent;
        }
        return current;
    }

    register<T>(name: string, service: T, options: ServiceRegistrationOptions = {}): T {
        if (this.hasLocal(name)) {
            throw new Error(`Service already registered: ${name}`);
        }

        this.services.set(name, service);
        this.metadata.set(name, this.createMetadata(name, options));
        return service;
    }

    registerFactory<T>(name: string, factory: ServiceFactory<T>, options: ServiceRegistrationOptions = {}): void {
        if (this.hasLocal(name)) {
            throw new Error(`Service already registered: ${name}`);
        }

        this.factories.set(name, factory);
        this.metadata.set(name, this.createMetadata(name, options));
    }

    has(name: string): boolean {
        return this.hasLocal(name) || this.parent?.has(name) === true;
    }

    hasLocal(name: string): boolean {
        return this.services.has(name) || this.factories.has(name);
    }

    get<T = unknown>(name: string): T {
        if (this.services.has(name)) {
            return this.services.get(name) as T;
        }

        const factory = this.factories.get(name);
        if (!factory) {
            if (this.parent?.has(name)) {
                return this.parent.get<T>(name);
            }

            throw new Error(`Service not registered: ${name}`);
        }

        const service = factory();
        this.factories.delete(name);
        this.services.set(name, service);
        return service as T;
    }

    getLocal<T = unknown>(name: string): T | undefined {
        if (this.services.has(name)) {
            return this.services.get(name) as T;
        }

        const factory = this.factories.get(name);
        if (!factory) {
            return undefined;
        }

        const service = factory();
        this.factories.delete(name);
        this.services.set(name, service);
        return service as T;
    }

    getMetadata(name: string): ServiceMetadata | undefined {
        return this.metadata.get(name) ?? this.parent?.getMetadata(name);
    }

    getLocalMetadata(): ServiceMetadata[] {
        return Array.from(this.metadata.values()).map((item) => ({
            ...item,
            dependencies: [...item.dependencies],
            lifecycle: [...item.lifecycle],
        }));
    }

    getAllMetadata(): ServiceMetadata[] {
        const parentMetadata = this.parent?.getAllMetadata() ?? [];
        const localNames = new Set(this.metadata.keys());
        return [...parentMetadata.filter((item) => !localNames.has(item.name)), ...this.getLocalMetadata()];
    }

    /**
     * 按 `dependencies` 拓扑排序当前 scope 的本地服务。
     * - 跨 scope 依赖：只要 parent.has(name) 成立即视为已满足，不参与排序。
     * - 缺失依赖：抛出 `Missing dependency` 错误。
     * - 存在环：抛出 `Service dependency cycle` 错误，附环路径。
     */
    getInitializationOrder(): ServiceMetadata[] {
        const local = new Map<string, ServiceMetadata>();
        for (const item of this.getLocalMetadata()) {
            local.set(item.name, item);
        }

        const cycles = this.detectCyclesIn(local);
        if (cycles.length > 0) {
            throw new Error(`Service dependency cycle detected: ${cycles.map((c) => c.join(' -> ')).join('; ')}`);
        }

        const result: ServiceMetadata[] = [];
        const visited = new Set<string>();
        const visit = (name: string): void => {
            if (visited.has(name)) {
                return;
            }
            const meta = local.get(name);
            if (!meta) {
                return;
            }
            visited.add(name);
            for (const dep of meta.dependencies) {
                if (local.has(dep)) {
                    visit(dep);
                } else if (!this.parent?.has(dep)) {
                    throw new Error(`Missing dependency '${dep}' required by service '${name}'`);
                }
            }
            result.push(meta);
        };

        for (const name of local.keys()) {
            visit(name);
        }
        return result;
    }

    /**
     * 返回当前 scope 中所有本地依赖环（每个环以 name 数组表示，首尾不重复）。
     * 跨 scope 依赖不参与环检测（视为外部边界）。
     */
    detectCycles(): string[][] {
        const local = new Map<string, ServiceMetadata>();
        for (const item of this.getLocalMetadata()) {
            local.set(item.name, item);
        }
        return this.detectCyclesIn(local);
    }

    private detectCyclesIn(local: Map<string, ServiceMetadata>): string[][] {
        const cycles: string[][] = [];
        const stack: string[] = [];
        const onStack = new Set<string>();
        const visited = new Set<string>();

        const dfs = (name: string): void => {
            if (onStack.has(name)) {
                const start = stack.indexOf(name);
                if (start >= 0) {
                    cycles.push(stack.slice(start).concat(name));
                }
                return;
            }
            if (visited.has(name) || !local.has(name)) {
                return;
            }
            visited.add(name);
            onStack.add(name);
            stack.push(name);
            for (const dep of local.get(name)!.dependencies) {
                if (local.has(dep)) {
                    dfs(dep);
                }
            }
            stack.pop();
            onStack.delete(name);
        };

        for (const name of local.keys()) {
            dfs(name);
        }
        return cycles;
    }

    /**
     * 按拓扑序对所有声明了 `initialize` lifecycle 且实现 `initialize(context)` 的本地服务调用初始化。
     * 仅扫描当前 scope，跨 scope 服务（如 root.events）由其拥有者负责。
     */
    async initializeAll(context: unknown): Promise<void> {
        const order = this.getInitializationOrder();
        const initialized: ServiceMetadata[] = [];
        try {
            for (const meta of order) {
                if (!meta.lifecycle.includes('initialize')) {
                    continue;
                }
                const service = this.getLocal<Record<string, unknown>>(meta.name);
                const initializer = service && (service as { initialize?: (ctx: unknown) => unknown }).initialize;
                if (typeof initializer === 'function') {
                    await initializer.call(service, context);
                    initialized.push(meta);
                }
            }
        } catch (error) {
            // Best-effort rollback: dispose 已经成功 initialize 的服务子集（反向序），仅释放 lifecycle 声明了 'dispose' 的服务。
            for (const meta of initialized.slice().reverse()) {
                if (!meta.lifecycle.includes('dispose')) {
                    continue;
                }
                const service = this.getLocal<Record<string, unknown>>(meta.name);
                const disposer = service && (service as { dispose?: () => unknown }).dispose;
                if (typeof disposer === 'function') {
                    try {
                        await disposer.call(service);
                    } catch (rollbackError) {
                        console.warn(`[uehper] Rollback dispose failed: ${meta.name}. ${(rollbackError as Error)?.stack ?? rollbackError}`);
                    }
                }
            }
            throw error;
        }
    }

    /**
     * 反向拓扑序释放本地服务：仅处理 lifecycle 包含 'dispose' 且实现 dispose() 的服务。
     */
    async disposeAll(): Promise<void> {
        const order = this.getInitializationOrder().slice().reverse();
        for (const meta of order) {
            if (!meta.lifecycle.includes('dispose')) {
                continue;
            }
            const service = this.getLocal<Record<string, unknown>>(meta.name);
            const disposer = service && (service as { dispose?: () => unknown }).dispose;
            if (typeof disposer === 'function') {
                try {
                    await disposer.call(service);
                } catch (error) {
                    console.warn(`[uehper] Service dispose failed: ${meta.name}. ${(error as Error)?.stack ?? error}`);
                }
            }
        }
    }

    clear(): void {
        this.factories.clear();
        this.services.clear();
        this.metadata.clear();
    }

    private createMetadata(name: string, options: ServiceRegistrationOptions): ServiceMetadata {
        return {
            name,
            scopeName: this.scopeName,
            dependencies: [...(options.dependencies ?? [])],
            lifecycle: [...(options.lifecycle ?? ['register'])],
        };
    }
}
