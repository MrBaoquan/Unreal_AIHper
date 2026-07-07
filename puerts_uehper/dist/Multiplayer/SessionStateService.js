"use strict";
/**
 * SessionStateService - 跨 World 持久的会话状态服务（P0-A 新增）。
 *
 * 职责：
 * - 承载 Swarm 房间控制相关的会话状态：role/roomId/sessionId/authority/topologyPhase。
 * - 挂在 rootContext（root-scoped），World 重建不销毁，保证 Swarm 控制面跨 World 连续。
 * - 提供只读查询接口供 World 层 Module 消费（通过 context.rootServices.getService('sessionState')）。
 * - 发射 session.* 事件（通过 rootContext 的 EventBus），通知 World 层会话状态变化。
 *
 * 依赖：
 * - rootContext 的 EventBus（'events' 服务）。
 * - 由 SessionModule（root-scoped Module）在 initialize 阶段创建并注册到 rootServices。
 *
 * 不包含：
 * - World 层状态（matchPhase/wave/economy），那些由 GameFlowModule 在 worldContext 维护。
 * - ANDLBE 兼容逻辑（框架底座零 ANDLBE 依赖）。
 * - 命令收发（由 DeviceAdminAdapter + CommandJournalService 负责）。
 *
 * 设计原则：Session/World 解耦（roadmap Section 0.2 第 1 条）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionStateService = exports.DefaultSessionStateService = void 0;
/**
 * SessionStateService 默认实现（纯内存，跨 World 持久由 rootContext 生命周期保证）。
 *
 * 未来 P0-A 第 10 步会新增 UUEHperSessionRootSubsystem（C++ GameInstanceSubsystem）
 * 持久化关键状态到 UObject，本类届时改为委托 C++ 实现。当前阶段先提供 TS 内存实现。
 */
class DefaultSessionStateService {
    constructor(events) {
        this.role = 'standalone';
        this.sessionPhase = 'idle';
        this.topologyPhase = 'idle';
        this.playerCount = 0;
        this.stateChangedHandlers = new Set();
        this.worldReadyHandlers = new Set();
        this.events = events;
    }
    getSnapshot() {
        return {
            role: this.role,
            roomId: this.roomId,
            sessionId: this.sessionId,
            worldId: this.worldId,
            sessionPhase: this.sessionPhase,
            topologyPhase: this.topologyPhase,
            authorityDeviceId: this.authorityDeviceId,
            playerCount: this.playerCount,
            lastCommandId: this.lastCommandId,
            lastCommandStatus: this.lastCommandStatus,
        };
    }
    getRole() {
        return this.role;
    }
    getRoomId() {
        return this.roomId;
    }
    getSessionId() {
        return this.sessionId;
    }
    getWorldId() {
        return this.worldId;
    }
    getSessionPhase() {
        return this.sessionPhase;
    }
    getTopologyPhase() {
        return this.topologyPhase;
    }
    isAuthority() {
        return this.role === 'server';
    }
    getPlayerCount() {
        return this.playerCount;
    }
    getPendingMatchSnapshot() {
        return this.pendingMatchSnapshot;
    }
    setRole(role) {
        this.updateField('role', role);
    }
    setRoomId(roomId) {
        this.updateField('roomId', roomId);
    }
    setSessionId(sessionId) {
        this.updateField('sessionId', sessionId);
    }
    setWorldId(worldId) {
        this.updateField('worldId', worldId);
    }
    setSessionPhase(phase) {
        this.updateField('sessionPhase', phase);
    }
    setTopologyPhase(phase) {
        this.updateField('topologyPhase', phase);
    }
    setAuthorityDeviceId(deviceId) {
        this.updateField('authorityDeviceId', deviceId);
    }
    setPlayerCount(count) {
        this.updateField('playerCount', count);
    }
    setLastCommand(commandId, status) {
        const previous = this.getSnapshot();
        this.lastCommandId = commandId;
        this.lastCommandStatus = status;
        this.emitStateChanged(previous, ['lastCommandId', 'lastCommandStatus']);
    }
    setPendingMatchSnapshot(snapshot) {
        this.pendingMatchSnapshot = snapshot;
    }
    notifyWorldReady(notification) {
        this.setWorldId(notification.worldId);
        this.worldReadyHandlers.forEach((handler) => {
            try {
                handler(notification);
            }
            catch (error) {
                console.warn(`[session] worldReady handler threw: ${error?.stack ?? error}`);
            }
        });
        this.events.emit('session.worldReady', notification);
    }
    onStateChanged(handler) {
        this.stateChangedHandlers.add(handler);
        return () => this.stateChangedHandlers.delete(handler);
    }
    onWorldReady(handler) {
        this.worldReadyHandlers.add(handler);
        return () => this.worldReadyHandlers.delete(handler);
    }
    updateField(field, value) {
        const previous = this.getSnapshot();
        if (previous[field] === value) {
            return;
        }
        this[field] = value;
        this.emitStateChanged(previous, [field]);
    }
    emitStateChanged(previous, changedFields) {
        const current = this.getSnapshot();
        const event = { previous, current, changedFields };
        this.stateChangedHandlers.forEach((handler) => {
            try {
                handler(event);
            }
            catch (error) {
                console.warn(`[session] stateChanged handler threw: ${error?.stack ?? error}`);
            }
        });
        this.events.emit('session.stateChanged', event);
    }
}
exports.DefaultSessionStateService = DefaultSessionStateService;
/**
 * 创建 SessionStateService 并注册到 rootContext.services。
 * 由 SessionModule（root-scoped）在 initialize 阶段调用。
 */
function createSessionStateService(rootContext) {
    const events = rootContext.services.get('events');
    const service = new DefaultSessionStateService(events);
    rootContext.services.register('sessionState', service, { lifecycle: ['register', 'dispose'] });
    return service;
}
exports.createSessionStateService = createSessionStateService;
//# sourceMappingURL=SessionStateService.js.map