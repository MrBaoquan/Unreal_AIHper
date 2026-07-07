/**
 * 多人能力包 —— opt-in 装配入口（L2 框架底座）。
 *
 * 把 玩家注册 / Actor 注册 两项服务集中打包，由业务项目
 * 通过 ProjectConfig.multiplayer = true 或在 GameApp.initializeWorld 阶段
 * 直接调用 registerMultiplayerCapabilityPack 显式开启。
 *
 * 设计原因：
 * 这些能力在多人/LBE 项目中是必需的，但与运行基础设施无关，单人/非联网项目
 * 不应被强制持有它们的预留接口位。从 DEFAULT_SERVICES.world 默认图降级后：
 *   - 非多人项目：createWorldServices 不再注册这两项；L3 拿不到也无需使用。
 *   - 多人项目：ProjectConfig.multiplayer 开关触发 ConfiguredProjectGameApp
 *     在 initializeWorld 阶段（先于 modules.initializeAll）调用本函数，
 *     保证多人 Module getService('playerRegistry') 等正常解析。
 *
 * Actor 状态同步由 UE 原生 Replication 承担，L2 不再提供 ActorStateSyncService。
 *
 * 依赖：framework ServiceRegistry（已存在）。
 */
import type { ServiceRegistry } from '../Framework/ServiceRegistry';
/** 多人能力包内服务名常量（与历史保持一致，确保 L3 `getService('playerRegistry')` 等无须改动）。 */
export declare const MULTIPLAYER_SERVICE_NAMES: readonly ["actorRegistry", "playerRegistry", "deviceTopology"];
/**
 * 把多人能力三项服务（actorRegistry / playerRegistry / deviceTopology）注册到指定 ServiceRegistry。
 * 必须在 modules.initializeAll 之前调用，否则多人 Module 的 getService 会因服务缺失而报错。
 * 重复调用幂等：若服务已存在，则 skip（不再覆盖既有实例）。
 *
 * @param world 当前 World 对象引用（字符串版），保留给未来需要直接绑定 World 上下文的多人能力扩展；
 *              当前两项构造均不直接依赖 world，可省略。
 */
export declare function registerMultiplayerCapabilityPack(services: ServiceRegistry, world?: unknown): void;
/** 检测某组服务是否已注册（doctor 或 GameApp 自检用）。 */
export declare function isMultiplayerCapabilityPackRegistered(services: ServiceRegistry): boolean;
//# sourceMappingURL=CapabilityPack.d.ts.map