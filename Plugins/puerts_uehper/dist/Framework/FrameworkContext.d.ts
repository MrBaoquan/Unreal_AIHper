import { FrameworkContext as IFrameworkContext, FrameworkLogger, WorldContextInfo } from './Lifecycle';
import { ServiceRegistry } from './ServiceRegistry';
export declare class FrameworkContext implements IFrameworkContext {
    readonly info: WorldContextInfo;
    readonly id: string;
    readonly world?: unknown;
    readonly services: ServiceRegistry;
    readonly rootServices: ServiceRegistry;
    readonly logger: FrameworkLogger;
    private readonly ownsServices;
    constructor(info: WorldContextInfo, services?: ServiceRegistry, ownsServices?: boolean);
    getService<T = unknown>(name: string): T;
    getLocalService<T = unknown>(name: string): T | undefined;
    beginPlay(): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=FrameworkContext.d.ts.map