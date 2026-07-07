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

export class DebugCommandRegistry {
    private readonly commands = new Map<string, DebugCommandSpec>();
    private readonly listeners = new Set<DebugCommandRegistryListener>();
    private capabilitiesHashCache?: string;

    /** 注册命令；同 id 重复注册视为替换 */
    register(spec: DebugCommandSpec): void {
        this.commands.set(spec.id, spec);
        this.capabilitiesHashCache = undefined;
        this.notify();
    }

    /** 注销命令 */
    unregister(id: string): boolean {
        const ok = this.commands.delete(id);
        if (ok) {
            this.capabilitiesHashCache = undefined;
            this.notify();
        }
        return ok;
    }

    /** 查询命令是否已注册 */
    has(id: string): boolean {
        return this.commands.has(id);
    }

    /** 列出所有命令的可序列化描述 —— 用于上报 Swarm */
    getCapabilities(): DebugCommandDescriptor[] {
        const result: DebugCommandDescriptor[] = [];
        for (const spec of this.commands.values()) {
            const params = spec.params.map((p) => {
                let suggestions = p.suggestions;
                if (spec.suggestionsProvider) {
                    try {
                        const dyn = spec.suggestionsProvider(p.key);
                        if (dyn && dyn.length > 0) {
                            suggestions = dyn;
                        }
                    } catch (e) {
                        console.warn(`[DebugCommandRegistry] suggestionsProvider failed for ${spec.id}.${p.key}: ${(e as Error).message}`);
                    }
                }
                return {
                    key: p.key,
                    label: p.label,
                    type: p.type,
                    options: p.options,
                    optionLabels: p.optionLabels,
                    suggestions,
                    min: p.min,
                    max: p.max,
                    default: p.default,
                    required: p.required,
                } satisfies DebugCommandParamSpec;
            });
            result.push({
                id: spec.id,
                label: spec.label,
                category: spec.category,
                scope: spec.scope,
                description: spec.description,
                params,
            });
        }
        return result;
    }

    /**
     * 计算 capabilities 内容哈希 —— 心跳里只带 hash，Swarm 检测到 hash 变化时再
     * 拉取完整 capabilities，避免心跳膨胀。
     */
    getCapabilitiesHash(): string {
        if (this.capabilitiesHashCache != null) {
            return this.capabilitiesHashCache;
        }
        const json = JSON.stringify(this.getCapabilities());
        // 简单的 32-bit FNV-1a，调试用途够了
        let hash = 0x811c9dc5;
        for (let i = 0; i < json.length; i++) {
            hash ^= json.charCodeAt(i);
            hash = (hash * 0x01000193) >>> 0;
        }
        this.capabilitiesHashCache = hash.toString(16);
        return this.capabilitiesHashCache;
    }

    /** 执行命令；未注册则返回 ok:false */
    async execute(id: string, params: Record<string, unknown>): Promise<DebugCommandResult> {
        const spec = this.commands.get(id);
        if (!spec) {
            return { ok: false, message: `unknown debug command: ${id}` };
        }
        try {
            // Swarm HTTP API 的 params 是 map[string]string；按 spec 中的 type 把字符串
            // 还原成 number/boolean，让业务 handler 拿到强类型数据。
            const coerced = this.coerceParams(spec, params ?? {});
            const ret = await Promise.resolve(spec.handler(coerced));
            if (ret && typeof ret === 'object' && 'ok' in ret) {
                return ret as DebugCommandResult;
            }
            return { ok: true };
        } catch (e) {
            const msg = (e as Error)?.message ?? String(e);
            console.error(`[DebugCommandRegistry] command ${id} failed: ${msg}`);
            return { ok: false, message: msg };
        }
    }

    private coerceParams(spec: DebugCommandSpec, params: Record<string, unknown>): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const p of spec.params) {
            let v = params[p.key];
            if (v === undefined || v === null) {
                if (p.default !== undefined) {
                    out[p.key] = p.default;
                }
                continue;
            }
            switch (p.type) {
                case 'number':
                    if (typeof v === 'string') {
                        const n = Number(v);
                        out[p.key] = Number.isFinite(n) ? n : undefined;
                    } else if (typeof v === 'number') {
                        out[p.key] = v;
                    }
                    break;
                case 'boolean':
                    if (typeof v === 'string') {
                        out[p.key] = v === 'true' || v === '1' || v === 'yes';
                    } else if (typeof v === 'boolean') {
                        out[p.key] = v;
                    }
                    break;
                case 'enum':
                case 'string':
                default:
                    out[p.key] = typeof v === 'string' ? v : String(v);
            }
        }
        // 透传未声明的额外键（业务可能塞元数据）
        for (const key of Object.keys(params)) {
            if (!(key in out)) {
                out[key] = params[key];
            }
        }
        return out;
    }

    /** 监听变更（用于 capabilities 上报刷新） */
    onChange(listener: DebugCommandRegistryListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** 清空（dispose 用） */
    clear(): void {
        this.commands.clear();
        this.capabilitiesHashCache = undefined;
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (e) {
                console.warn(`[DebugCommandRegistry] listener failed: ${(e as Error).message}`);
            }
        }
    }
}
