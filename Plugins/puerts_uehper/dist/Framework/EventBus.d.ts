export type EventHandler<TPayload = unknown> = (payload: TPayload) => void;
export type Unsubscribe = () => void;
export declare class EventBus {
    private readonly handlers;
    on<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe;
    once<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe;
    off<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): void;
    emit<TPayload = unknown>(eventName: string, payload: TPayload): void;
    clear(): void;
    dispose(): void;
}
/**
 * 世界作用域事件总线门面（World-scoped EventBus facade）。
 *
 * 背景：默认 'events' 是 root 单例，所有 world 共享。world 级模块通过
 * `context.getService('events')` 订阅时，订阅句柄登记在 root 总线上；若 world 销毁
 * （如 server-travel 重建世界）时模块不退订，旧 world 的 handler 会残留在 root 总线，
 * 下次 emit 时仍被触发，在已销毁的 UE 对象上操作抛错或串扰活跃 world。
 *
 * 该门面包裹 root 总线：`on/once` 在 root 上注册并登记到本作用域；`emit/off` 直接委托
 * root（保持跨 world + root 模块的全局扇出行为不变）；`dispose()` 一次性退订本作用域
 * 登记的全部 handler。框架在 world 服务 `disposeAll()` 时调用 dispose，使 world 模块
 * 无需各自维护退订即可整体清理，杜绝残留订阅泄漏。
 */
export declare class ScopedEventBus {
    private readonly root;
    private readonly scopedUnsubscribes;
    constructor(root: EventBus);
    on<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe;
    once<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe;
    off<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): void;
    emit<TPayload = unknown>(eventName: string, payload: TPayload): void;
    clear(): void;
    dispose(): void;
}
//# sourceMappingURL=EventBus.d.ts.map