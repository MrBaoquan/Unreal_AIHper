import { FrameworkContext as IFrameworkContext, FrameworkLogger, WorldContextInfo } from './Lifecycle';
import { ServiceRegistry } from './ServiceRegistry';

class ConsoleFrameworkLogger implements FrameworkLogger {
    constructor(private readonly prefix: string) {}

    info(message: string): void {
        console.log(`${this.prefix} ${message}`);
    }

    warn(message: string): void {
        console.warn(`${this.prefix} ${message}`);
    }

    error(message: string): void {
        console.error(`${this.prefix} ${message}`);
    }
}

export class FrameworkContext implements IFrameworkContext {
    readonly id: string;
    readonly world?: unknown;
    readonly services: ServiceRegistry;
    readonly rootServices: ServiceRegistry;
    readonly logger: FrameworkLogger;
    private readonly ownsServices: boolean;

    constructor(
        readonly info: WorldContextInfo,
        services?: ServiceRegistry,
        ownsServices = services == null,
    ) {
        this.id = info.id;
        this.world = info.world;
        this.ownsServices = ownsServices;
        this.services = services ?? new ServiceRegistry();
        this.rootServices = this.services.getRoot();
        this.logger = new ConsoleFrameworkLogger(`[uehper:${this.id}]`);
    }

    getService<T = unknown>(name: string): T {
        return this.services.get<T>(name);
    }

    getLocalService<T = unknown>(name: string): T | undefined {
        return this.services.getLocal<T>(name);
    }

    async beginPlay(): Promise<void> {
        this.logger.info('FrameworkContext beginPlay');
    }

    async dispose(): Promise<void> {
        this.logger.info('FrameworkContext dispose');
        if (this.ownsServices) {
            this.services.clear();
        }
    }
}
