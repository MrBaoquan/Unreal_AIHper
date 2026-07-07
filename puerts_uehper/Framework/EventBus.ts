export type EventHandler<TPayload = unknown> = (payload: TPayload) => void;
export type Unsubscribe = () => void;

export class EventBus {
    private readonly handlers = new Map<string, Set<EventHandler>>();

    on<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe {
        let eventHandlers = this.handlers.get(eventName);
        if (!eventHandlers) {
            eventHandlers = new Set<EventHandler>();
            this.handlers.set(eventName, eventHandlers);
        }

        eventHandlers.add(handler as EventHandler);
        return () => this.off(eventName, handler);
    }

    once<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe {
        const unsubscribe = this.on<TPayload>(eventName, (payload) => {
            unsubscribe();
            handler(payload);
        });

        return unsubscribe;
    }

    off<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): void {
        const eventHandlers = this.handlers.get(eventName);
        if (!eventHandlers) {
            return;
        }

        eventHandlers.delete(handler as EventHandler);
        if (eventHandlers.size === 0) {
            this.handlers.delete(eventName);
        }
    }

    emit<TPayload = unknown>(eventName: string, payload: TPayload): void {
        const eventHandlers = this.handlers.get(eventName);
        if (!eventHandlers) {
            return;
        }

        // Per-handler 异常隔离：单个订阅者抛异常不得中断对其余订阅者的派发。
        // 典型场景：server-travel 后残留的旧 world context 仍订阅在共享根总线上，
        // 其 handler 在已销毁的 UE 对象上操作抛错（"passing a invalid object"），
        // 若不隔离会中断遍历，导致活跃 world 的 handler 收不到事件。
        for (const handler of Array.from(eventHandlers)) {
            try {
                handler(payload);
            } catch (e) {
                const message = (e as Error)?.message ?? String(e);
                console.warn(`[EventBus] handler for "${eventName}" threw, isolated: ${message}`);
            }
        }
    }

    clear(): void {
        this.handlers.clear();
    }

    dispose(): void {
        this.clear();
    }
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
export class ScopedEventBus {
    private readonly scopedUnsubscribes = new Set<Unsubscribe>();

    constructor(private readonly root: EventBus) {}

    on<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe {
        const rootUnsub = this.root.on<TPayload>(eventName, handler);
        const scopedUnsub: Unsubscribe = () => {
            this.scopedUnsubscribes.delete(scopedUnsub);
            rootUnsub();
        };
        this.scopedUnsubscribes.add(scopedUnsub);
        return scopedUnsub;
    }

    once<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): Unsubscribe {
        const unsubscribe = this.on<TPayload>(eventName, (payload) => {
            unsubscribe();
            handler(payload);
        });
        return unsubscribe;
    }

    off<TPayload = unknown>(eventName: string, handler: EventHandler<TPayload>): void {
        // 直接委托 root；本作用域登记的 wrapper unsub 之后被调用时对 root.off 再调用一次是幂等的。
        this.root.off(eventName, handler);
    }

    emit<TPayload = unknown>(eventName: string, payload: TPayload): void {
        // 委托 root，保持跨 world + root 订阅者的全局扇出行为不变。
        this.root.emit(eventName, payload);
    }

    clear(): void {
        for (const unsub of Array.from(this.scopedUnsubscribes)) {
            try {
                unsub();
            } catch (e) {
                console.warn(`[ScopedEventBus] unsubscribe threw, ignored: ${(e as Error)?.message ?? e}`);
            }
        }
        this.scopedUnsubscribes.clear();
    }

    dispose(): void {
        this.clear();
    }
}
