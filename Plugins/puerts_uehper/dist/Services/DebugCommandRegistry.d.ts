/**
 * DebugCommandRegistry - 通用调试/远程命令注册中心
 *
 * 职责（L2 框架，跨项目复用）：
 * - 由项目层声明 DebugCommandSpec（id + 参数 schema + handler）注册到 Registry
 * - 通过 getCapabilities() 把可序列化的 spec 描述（剥离 handler）暴露给 Swarm
 *   端，由 Swarm Web UI 动态渲染表单
 * - 通过 execute(id, params) 派发 Swarm 下发的命令到对应 handler
 *
 * 设计原则：
 * - 框架不感知具体业务命令名（wave/debug-spawn/...），只懂结构化协议
 * - 参数 schema 只支持 enum/number/string/boolean 四种类型 + suggestions（运行时
 *   求值字符串列表），覆盖绝大部分调试场景；如果某项目需要自定义控件，应在 Swarm
 *   Web 端注入 customControl 渲染（后续扩展）
 *
 * 引用关系：
 * - 被 puerts_uehper/index.ts 导出
 * - 业务层（TypeScript/Modules/...）实例化并注册 spec
 * - SwarmCommandDispatcher 在未识别命令时查询此 Registry 派发
 * - DeviceAdminAdapter 在 TCP register 时调用 getCapabilities() 上报到 Swarm
 */
/** 单个参数的描述 schema —— 可序列化到 Swarm 端，用于渲染表单 */
export interface DebugCommandParamSpec {
    /** 参数键名（命令 envelope.params 的 key） */
    readonly key: string;
    /** UI 显示标签 */
    readonly label?: string;
    /** 参数类型 —— 决定 Swarm 端渲染控件 */
    readonly type: 'enum' | 'number' | 'string' | 'boolean';
    /** type=enum 时的可选值列表 */
    readonly options?: readonly string[];
    /** type=enum 时每个 option 的中文显示标签（key 为 option 值，value 为 UI 显示文本） */
    readonly optionLabels?: Readonly<Record<string, string>>;
    /** type=string 时的建议值（下拉提示） —— 注意：序列化时为字符串数组快照，业务层
     * 可通过 `suggestionsProvider` 在 register 时延迟求值 */
    readonly suggestions?: readonly string[];
    /** type=number 时的最小值 */
    readonly min?: number;
    /** type=number 时的最大值 */
    readonly max?: number;
    /** 默认值（任意类型）。Swarm 端首次渲染时用 */
    readonly default?: string | number | boolean;
    /** 是否必填，默认 true */
    readonly required?: boolean;
}
/** 命令描述符 —— 可序列化部分（不含 handler），用于上报 Swarm */
export interface DebugCommandDescriptor {
    /** 命令 ID（对应 Envelope.name） */
    readonly id: string;
    /** UI 显示标签 */
    readonly label: string;
    /** UI 分组（"flow"/"debug"/"economy" 等任意字符串，Swarm 按此分组渲染卡片） */
    readonly category?: string;
    /** 命令作用域，与现有 Envelope.scope 语义一致 */
    readonly scope?: 'session' | 'world' | 'room' | 'global';
    /** 命令简介，Swarm UI 鼠标悬浮显示 */
    readonly description?: string;
    /** 参数 schema 列表 */
    readonly params: readonly DebugCommandParamSpec[];
}
/** 命令注册条目 —— 含运行时 handler */
export interface DebugCommandSpec extends DebugCommandDescriptor {
    /** 命令处理函数。返回值可选，会作为 result 回传到 Swarm */
    readonly handler: (params: Record<string, unknown>) => void | Promise<void> | DebugCommandResult | Promise<DebugCommandResult>;
    /** 可选：动态生成 suggestions（覆盖静态 suggestions 字段） */
    readonly suggestionsProvider?: (paramKey: string) => readonly string[];
}
/** 命令执行结果 —— Swarm 端可见 */
export interface DebugCommandResult {
    readonly ok: boolean;
    readonly message?: string;
    readonly data?: Record<string, unknown>;
}
/** Registry 变更监听 */
export type DebugCommandRegistryListener = () => void;
export declare class DebugCommandRegistry {
    private readonly commands;
    private readonly listeners;
    private capabilitiesHashCache?;
    /** 注册命令；同 id 重复注册视为替换 */
    register(spec: DebugCommandSpec): void;
    /** 注销命令 */
    unregister(id: string): boolean;
    /** 查询命令是否已注册 */
    has(id: string): boolean;
    /** 列出所有命令的可序列化描述 —— 用于上报 Swarm */
    getCapabilities(): DebugCommandDescriptor[];
    /**
     * 计算 capabilities 内容哈希 —— 心跳里只带 hash，Swarm 检测到 hash 变化时再
     * 拉取完整 capabilities，避免心跳膨胀。
     */
    getCapabilitiesHash(): string;
    /** 执行命令；未注册则返回 ok:false */
    execute(id: string, params: Record<string, unknown>): Promise<DebugCommandResult>;
    private coerceParams;
    /** 监听变更（用于 capabilities 上报刷新） */
    onChange(listener: DebugCommandRegistryListener): () => void;
    /** 清空（dispose 用） */
    clear(): void;
    private notify;
}
//# sourceMappingURL=DebugCommandRegistry.d.ts.map