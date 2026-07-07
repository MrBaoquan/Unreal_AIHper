"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultInterventionSource = void 0;
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
class DefaultInterventionSource {
    constructor() {
        this.sourceId = 'default';
        this.handlers = new Set();
    }
    onInterventionRequest(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    reportResult(commandId, result) {
        // 默认实现仅日志，避免引入未实现的依赖；业务子类可覆盖以回传给真实控制端
        console.log(`[intervention:default] reportResult commandId=${commandId} result=${result}`);
    }
    /**
     * 内部方法：外层收到外部命令后调用此方法，
     * 将命令转发为 InterventionRequest 通知所有订阅者。
     */
    dispatchIntervention(request) {
        this.handlers.forEach((handler) => {
            try {
                handler(request);
            }
            catch (error) {
                console.warn(`[intervention:default] handler threw: ${error?.stack ?? error}`);
            }
        });
    }
}
exports.DefaultInterventionSource = DefaultInterventionSource;
//# sourceMappingURL=InterventionPort.js.map