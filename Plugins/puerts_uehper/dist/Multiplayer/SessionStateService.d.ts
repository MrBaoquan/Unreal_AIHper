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
import type { FrameworkContext } from '../Framework/Lifecycle';
import type { EventBus } from '../Framework/EventBus';
/** 设备角色 */
export type DeviceRole = 'idle' | 'server' | 'client' | 'standalone';
/** 会话阶段（跨 World 持久，与 world.matchPhase 区分） */
export type SessionPhase = 'idle' | 'lobby' | 'inMatch' | 'settled' | 'migrating';
/** 拓扑阶段（房间拓扑切换过程状态） */
export type TopologyPhase = 'idle' | 'startingServer' | 'serverReady' | 'connectingClient' | 'clientConnected' | 'ready' | 'failed';
/** 会话状态快照（只读视图，供 World 层查询） */
export interface SessionStateSnapshot {
    readonly role: DeviceRole;
    readonly roomId: string | undefined;
    readonly sessionId: string | undefined;
    readonly worldId: string | undefined;
    readonly sessionPhase: SessionPhase;
    readonly topologyPhase: TopologyPhase;
    readonly authorityDeviceId: string | undefined;
    readonly playerCount: number;
    readonly lastCommandId: string | undefined;
    readonly lastCommandStatus: CommandStatus | undefined;
}
/** 命令状态（与 roadmap Section 3.3 命令生命周期一致） */
export type CommandStatus = 'accepted' | 'running' | 'completed' | 'rejected' | 'failed' | 'expired';
/** 会话状态变更事件 payload */
export interface SessionStateChangedEvent {
    readonly previous: SessionStateSnapshot;
    readonly current: SessionStateSnapshot;
    readonly changedFields: readonly (keyof SessionStateSnapshot)[];
}
/** World 就绪通知 payload（World 层 Module 在 onWorldBeginPlay 时回调） */
export interface WorldReadyNotification {
    readonly worldId: string;
    readonly hasAuthority: boolean;
    /** P3 联调: 设备 ID（由 World 层传入，保证与 UDP 心跳 deviceId 一致） */
    readonly deviceId?: string;
    /** P3 联调: PIE 实例 ID（多实例区分） */
    readonly pieInstanceId?: number;
    /** P3 联调: World 对象引用（用于获取 GameInstance，C++ Subsystem 延迟获取） */
    readonly world?: unknown;
}
/**
 * 待恢复的比赛快照（Host Migration 场景，World 层在 initialize 时查询）。
 *
 * 框架只承载通用骨架字段（snapshotId / matchPhase / savedAt / payload），
 * 业务层用泛型参数 TPayload 承载自己项目特定的快照契约（如某塔防项目的
 * "当前波次 / 核心塔血量 / 共享货币"等），由 L3 自行定义 payload 类型。
 */
export interface PendingMatchSnapshot<TPayload = unknown> {
    readonly snapshotId: string;
    readonly matchPhase: string;
    readonly payload: TPayload;
    readonly savedAt: number;
}
/**
 * SessionStateService - 会话状态服务接口。
 *
 * 实现类挂在 rootContext.services，World 层通过 context.rootServices.getService<SessionStateService>('sessionState') 获取。
 */
export interface SessionStateService {
    /** 获取当前会话状态只读快照 */
    getSnapshot(): SessionStateSnapshot;
    /** 查询设备角色 */
    getRole(): DeviceRole;
    /** 查询房间 ID */
    getRoomId(): string | undefined;
    /** 查询会话 ID */
    getSessionId(): string | undefined;
    /** 查询当前 World ID */
    getWorldId(): string | undefined;
    /** 查询会话阶段 */
    getSessionPhase(): SessionPhase;
    /** 查询拓扑阶段 */
    getTopologyPhase(): TopologyPhase;
    /** 是否为权威端（server） */
    isAuthority(): boolean;
    /** 查询玩家数量 */
    getPlayerCount(): number;
    /** 查询待恢复的比赛快照（Host Migration 场景） */
    getPendingMatchSnapshot(): PendingMatchSnapshot | undefined;
    /** 设置设备角色（由 SessionModule 在处理 set-server/set-client 命令时调用） */
    setRole(role: DeviceRole): void;
    /** 设置房间 ID */
    setRoomId(roomId: string | undefined): void;
    /** 设置会话 ID */
    setSessionId(sessionId: string | undefined): void;
    /** 设置当前 World ID（由 World 层在 onWorldBeginPlay 时调用 notifyWorldReady） */
    setWorldId(worldId: string | undefined): void;
    /** 设置会话阶段 */
    setSessionPhase(phase: SessionPhase): void;
    /** 设置拓扑阶段 */
    setTopologyPhase(phase: TopologyPhase): void;
    /** 设置权威设备 ID */
    setAuthorityDeviceId(deviceId: string | undefined): void;
    /** 设置玩家数量 */
    setPlayerCount(count: number): void;
    /** 设置最后命令状态（由 CommandJournalService 在命令状态变化时调用） */
    setLastCommand(commandId: string | undefined, status: CommandStatus | undefined): void;
    /** 设置待恢复的比赛快照（Host Migration 场景，由 MatchSnapshotService 在检测到迁移时调用） */
    setPendingMatchSnapshot(snapshot: PendingMatchSnapshot | undefined): void;
    /** World 层在 onWorldBeginPlay 时通知 Session 层 World 已就绪 */
    notifyWorldReady(notification: WorldReadyNotification): void;
    /** 订阅会话状态变更事件（通过 rootContext EventBus 的 'session.stateChanged' 事件） */
    onStateChanged(handler: (event: SessionStateChangedEvent) => void): () => void;
    /** 订阅 World 就绪事件（Session 层据此知道可下发 world-scope 命令） */
    onWorldReady(handler: (notification: WorldReadyNotification) => void): () => void;
}
/**
 * SessionStateService 默认实现（纯内存，跨 World 持久由 rootContext 生命周期保证）。
 *
 * 未来 P0-A 第 10 步会新增 UUEHperSessionRootSubsystem（C++ GameInstanceSubsystem）
 * 持久化关键状态到 UObject，本类届时改为委托 C++ 实现。当前阶段先提供 TS 内存实现。
 */
export declare class DefaultSessionStateService implements SessionStateService {
    private role;
    private roomId;
    private sessionId;
    private worldId;
    private sessionPhase;
    private topologyPhase;
    private authorityDeviceId;
    private playerCount;
    private lastCommandId;
    private lastCommandStatus;
    private pendingMatchSnapshot;
    private readonly events;
    private readonly stateChangedHandlers;
    private readonly worldReadyHandlers;
    constructor(events: EventBus);
    getSnapshot(): SessionStateSnapshot;
    getRole(): DeviceRole;
    getRoomId(): string | undefined;
    getSessionId(): string | undefined;
    getWorldId(): string | undefined;
    getSessionPhase(): SessionPhase;
    getTopologyPhase(): TopologyPhase;
    isAuthority(): boolean;
    getPlayerCount(): number;
    getPendingMatchSnapshot(): PendingMatchSnapshot | undefined;
    setRole(role: DeviceRole): void;
    setRoomId(roomId: string | undefined): void;
    setSessionId(sessionId: string | undefined): void;
    setWorldId(worldId: string | undefined): void;
    setSessionPhase(phase: SessionPhase): void;
    setTopologyPhase(phase: TopologyPhase): void;
    setAuthorityDeviceId(deviceId: string | undefined): void;
    setPlayerCount(count: number): void;
    setLastCommand(commandId: string | undefined, status: CommandStatus | undefined): void;
    setPendingMatchSnapshot(snapshot: PendingMatchSnapshot | undefined): void;
    notifyWorldReady(notification: WorldReadyNotification): void;
    onStateChanged(handler: (event: SessionStateChangedEvent) => void): () => void;
    onWorldReady(handler: (notification: WorldReadyNotification) => void): () => void;
    private updateField;
    private emitStateChanged;
}
/**
 * 创建 SessionStateService 并注册到 rootContext.services。
 * 由 SessionModule（root-scoped）在 initialize 阶段调用。
 */
export declare function createSessionStateService(rootContext: FrameworkContext): SessionStateService;
//# sourceMappingURL=SessionStateService.d.ts.map