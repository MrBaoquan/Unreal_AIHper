/**
 * 默认服务元数据的唯一来源（Stage 6.17）。
 * 仅描述核心腰带服务的拓扑/lifecycle 元信息，不包含实例构造逻辑；
 * FrameworkApp.registerDefaultServices / createWorldServices 与 Cli/doctor.js 都从这里读取，
 * 确保 doctor 的静态分析输出与运行时实际注册一致。
 *
 * 多人能力（actorRegistry / playerRegistry）已降级为 opt-in：
 * 见 Multiplayer/CapabilityPack.ts，由业务侧 ProjectConfig.multiplayer = true 触发装配，
 * 不在核心腰带默认图内，doctor 不会强制要求其存在。
 */
import type { ServiceLifecyclePhase } from './ServiceRegistry';

export interface DefaultServiceDescriptor {
    name: string;
    dependencies: string[];
    lifecycle: ServiceLifecyclePhase[];
}

export interface DefaultServiceGraph {
    root: DefaultServiceDescriptor[];
    world: DefaultServiceDescriptor[];
    /** opt-in 多人能力包子图（doctor 不强制要求装入）。 */
    multiplayer?: DefaultServiceDescriptor[];
}

export const DEFAULT_SERVICES: DefaultServiceGraph = {
    root: [
        { name: 'events', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'commands', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'resources', dependencies: [], lifecycle: ['register', 'dispose'] },
    ],
    world: [
        { name: 'events', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'modules', dependencies: [], lifecycle: ['register', 'initialize', 'start', 'stop', 'dispose'] },
        { name: 'scenes', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'saveGames', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'timers', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'playerInput', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'worldResources', dependencies: ['resources'], lifecycle: ['register', 'dispose'] },
        { name: 'ui', dependencies: ['worldResources', 'playerInput'], lifecycle: ['register', 'dispose'] },
    ],
    /** opt-in 多人能力包子图；由 registerMultiplayerCapabilityPack(services, world) 装入。 */
    multiplayer: [
        { name: 'actorRegistry', dependencies: [], lifecycle: ['register', 'dispose'] },
        { name: 'playerRegistry', dependencies: [], lifecycle: ['register', 'dispose'] },
    ],
};

/** Lookup helper used by both FrameworkApp 与 doctor. */
export function findDefaultServiceMeta(scope: 'root' | 'world', name: string): DefaultServiceDescriptor | undefined {
    return DEFAULT_SERVICES[scope].find((entry) => entry.name === name);
}
