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
export declare const DEFAULT_SERVICES: DefaultServiceGraph;
/** Lookup helper used by both FrameworkApp 与 doctor. */
export declare function findDefaultServiceMeta(scope: 'root' | 'world', name: string): DefaultServiceDescriptor | undefined;
//# sourceMappingURL=DefaultServices.d.ts.map