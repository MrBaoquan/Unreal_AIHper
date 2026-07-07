/**
 * InterventionPort - 干预源抽象接口。
 *
 * 职责：
 * - 抽象"干预源"概念：把外部命令/检查点/远程控制等异质信号统一为 InterventionRequest，
 *   经 InterventionRouter 路由到具体执行器。
 * - 框架只提供抽象与一个通用的空实现 DefaultInterventionSource，业务层按需提供自定义源。
 *
 * 设计原则：
 * - 框架底座零第三方依赖：本文件不 import 任何具体传输/网络类型。
 * - 框架不识别"波次/检查点/塔"等业务动作词表；`action` 用 `string` 承载，
 *   动作白名单与路由规则完全由 L3 业务层（如 InterventionRouter / InterventionService）定义。
 *
 * 落点：L2 puerts_uehper/Multiplayer/（root-scoped，跨 World 持久）。
 */
/** 干预动作类型。框架不约束取值集合，业务层按需建立白名单与路由规则。 */
export type InterventionAction = string;
/** 干预请求（统一格式，所有干预源转发为此结构） */
export interface InterventionRequest {
    /** 干预动作 */
    readonly action: InterventionAction;
    /** 动作参数（不同 action 不同结构） */
    readonly params: Readonly<Record<string, unknown>>;
    /** 干预源 ID（'swarm' | 'andlbe' | ...） */
    readonly source: string;
    /** 命令唯一 ID（用于去重，Swarm 命令用 commandId，ANDLBE 检查点用合成 ID） */
    readonly commandId: string;
    /** 可选：目标 World ID（缺省为当前活跃 World） */
    readonly worldId?: string;
    /** 可选：命令作用域（与 Envelope.targetScope 一致） */
    readonly targetScope?: 'session' | 'world' | 'level';
}
/** 命令执行结果（回传给干预源，闭合命令生命周期） */
export type InterventionResult = 'accepted' | 'completed' | 'failed';
/** 取消订阅函数 */
export type InterventionUnsubscribe = () => void;
/**
 * InterventionPort - 干预源抽象接口。
 *
 * 实现类负责将特定来源（外部控制端 / 本地检查点 / 任意源）的干预信号
 * 转换为统一的 InterventionRequest，并通过 onInterventionRequest 回调通知订阅方。
 */
export interface InterventionPort {
    /** 干预源 ID（业务自定义字符串，如 'swarm' / 'andlbe' / 自定义） */
    readonly sourceId: string;
    /**
     * 注册干预请求处理器。
     * 当干预源收到命令/事件时，调用 handler 传入统一 InterventionRequest。
     * 返回取消订阅函数。
     */
    onInterventionRequest(handler: (request: InterventionRequest) => void): InterventionUnsubscribe;
    /**
     * 回传命令执行结果给干预源。具体实现可写往原始通道，或 no-op。
     */
    reportResult(commandId: string, result: InterventionResult): void;
}
/**
 * DefaultInterventionSource - 框架提供的默认空实现（L2 框架底座）。
 *
 * 暴露 dispatchIntervention 给外层手工注入 InterventionRequest，
 * 业务层若需对接真实控制端（如某远程控制服务），可继承或包装此类，
 * 也可实现 InterventionPort 自己接管 onInterventionRequest/reportResult。
 *
 * 注意：session-scope 命令（如设定角色/踢人）由 SessionModule 直接处理，
 * 不经过 InterventionPort，因为它们是拓扑控制而非局内干预。
 */
export declare class DefaultInterventionSource implements InterventionPort {
    readonly sourceId = "default";
    private readonly handlers;
    onInterventionRequest(handler: (request: InterventionRequest) => void): InterventionUnsubscribe;
    reportResult(commandId: string, result: InterventionResult): void;
    /**
     * 内部方法：外层收到外部命令后调用此方法，
     * 将命令转发为 InterventionRequest 通知所有订阅者。
     */
    dispatchIntervention(request: InterventionRequest): void;
}
//# sourceMappingURL=InterventionPort.d.ts.map