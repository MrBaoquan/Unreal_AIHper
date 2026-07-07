/**
 * 设备拓扑服务（L2 框架通用能力）
 *
 * 解决"同网段设备互相发现 + 房间拓扑维护 + 自动选主"的通用问题。
 * 不依赖任何特定房间系统（ANDLBE/Swarm/未来其他），只接收 deviceId/ip/room 等通用字段。
 *
 * 设计原则：
 * - 通用性：不包含 playerId/appId/pose 等房间系统特定概念，只认 deviceId
 * - 可插拔选主：默认电量最高优先，deviceId 字典序兜底，业务可自定义 ElectionRule
 * - 实时性：切房/入房 500ms 稳定窗口，响应式心跳加速互相发现，server 掉线 3s 突破冷却
 * - 可靠性：心跳超时 3s（3 周期）清理，epoch 仲裁多 server 冲突
 *
 * 依赖：
 * - 由 L3 Adapter 桥接 C++ OnDeviceHeartbeatReceived 委托，调 ingestHeartbeat(payload)
 * - 由 L3 Adapter 桥接 C++ BroadcastHeartbeatNow()，实现响应式心跳
 * - 由 RoomSessionService 在房间变化时调 setLocalRoom(roomId)
 *
 * 落点：puerts_uehper/Services/DeviceTopologyService.ts（L2 框架底座）
 */
import type { Unsubscribe } from '../Framework/EventBus';
/** 设备拓扑成员（通用，不依赖任何房间系统） */
export interface DeviceMember {
    /** 设备唯一标识（uehper 的 deviceId，如 "pico-hostA-android"） */
    readonly deviceId: string;
    /** 设备 LAN IP */
    readonly ip: string;
    /** 所在房间标识（任何来源的字符串房间 ID，可为空表示"未分组"） */
    readonly roomId?: string;
    /** 是否已作为业务 Listen Server */
    readonly isServer: boolean;
    /** 业务端口（isServer=true 时有效） */
    readonly serverPort?: number;
    /** server epoch（isServer=true 时有效，用于多 server 仲裁） */
    readonly serverEpoch?: number;
    /** 设备电量百分比（0-100，选主权重用，-1 表示未知） */
    readonly batteryLevel?: number;
    /** 最后心跳时间戳（ms） */
    readonly lastSeenMs: number;
    /** 元数据（供业务层扩展，框架不解释） */
    readonly metadata?: Record<string, unknown>;
}
/** 房间拓扑快照 */
export interface RoomTopology {
    readonly roomId?: string;
    readonly members: readonly DeviceMember[];
    readonly serverDeviceId?: string;
    readonly serverIp?: string;
    readonly serverPort?: number;
    readonly serverEpoch?: number;
}
/** 选主结果 */
export interface ElectionResult {
    readonly electedDeviceId: string;
    readonly isLocal: boolean;
    readonly epoch: number;
    readonly reason: 'noServer' | 'serverStale' | 'forced';
}
/** 心跳包载荷（从 C++ OnDeviceHeartbeatReceived 收到，JSON 解析后） */
export interface DeviceHeartbeatPayload {
    readonly deviceId: string;
    readonly ip: string;
    readonly role?: string;
    readonly room?: string;
    readonly gamePort?: number;
    readonly gameState?: string;
    readonly ownerSwarm?: string;
    readonly ownerEpoch?: number;
    readonly [key: string]: unknown;
}
/** 拓扑服务配置 */
export interface DeviceTopologyConfig {
    readonly localDeviceId: string;
    readonly localIp: string;
    /** 心跳超时（ms），默认 3000（3 个心跳周期） */
    readonly heartbeatTimeoutMs?: number;
    /** 拓扑稳定窗口（ms），默认 500（切房/入房快速通过） */
    readonly stableWindowMs?: number;
    /** 选主冷却窗口（ms），默认 15000 */
    readonly electionCooldownMs?: number;
    /** 周期清理间隔（ms），默认 500 */
    readonly cleanupIntervalMs?: number;
}
/** 拓扑变化事件类型 */
export type TopologyEventType = 'memberJoined' | 'memberLeft' | 'serverChanged' | 'roomChanged';
export interface TopologyChangedEvent {
    readonly type: TopologyEventType;
    readonly previousTopology: RoomTopology;
    readonly currentTopology: RoomTopology;
    readonly affectedDeviceId?: string;
}
/** 选主规则接口（可插拔） */
export interface ElectionRule {
    /** 从成员列表中选出 host deviceId */
    elect(members: readonly DeviceMember[]): string | undefined;
}
/**
 * 默认选主规则：电量最高优先，deviceId 字典序兜底。
 *
 * 策略：
 * 1. 电量已知（>=0）的设备优先于电量未知（<0）的设备
 * 2. 电量高的优先（保证最大可用性，Listen Server 耗电高）
 * 3. 电量相同时，deviceId 字典序小的优先（确定性）
 */
export declare class BatteryPriorityElectionRule implements ElectionRule {
    elect(members: readonly DeviceMember[]): string | undefined;
}
/** External host command from third-party room system (ANDLBE HostChanged / Swarm set-server) */
export interface ExternalHostCommand {
    readonly role: 'server' | 'client' | 'idle';
    readonly serverIp?: string;
    readonly port?: number;
    readonly source: 'swarm' | 'andlbe' | 'lan';
    readonly hostPlayerId?: number;
    readonly reason?: string;
}
/**
 * 设备拓扑服务接口。
 *
 * L2 框架只定义接口，默认实现在 DefaultDeviceTopologyService 中。
 * L3 业务层通过 Adapter 桥接 C++ 委托，调 ingestHeartbeat/triggerImmediateHeartbeat。
 */
export interface DeviceTopologyService {
    readonly serviceName: 'deviceTopology';
    start(config: DeviceTopologyConfig): void;
    stop(): void;
    dispose(): void;
    /** 设置本机所在房间（RoomSessionService 在房间变化时调用） */
    setLocalRoom(roomId: string | undefined): void;
    /** 宣告本机成为 server（当选后调用） */
    announceServer(port: number, epoch: number): void;
    /** 撤销本机 server 身份（降级时调用） */
    revokeServer(): void;
    /** 收到外部心跳包（由 Adapter 桥接 C++ 委托调用） */
    ingestHeartbeat(payload: DeviceHeartbeatPayload): void;
    /** 设置立即心跳回调（响应式发现用） */
    setImmediateHeartbeatCallback(callback: (() => void) | undefined): void;
    /** 获取当前拓扑 */
    getTopology(): RoomTopology;
    /** 拓扑变化订阅 */
    onTopologyChanged(handler: (event: TopologyChangedEvent) => void): Unsubscribe;
    /** 请求选主（返回选主结果，不执行 OpenAsListenServer） */
    requestElection(): ElectionResult | undefined;
    /** 设置选主规则（默认 BatteryPriorityElectionRule） */
    setElectionRule(rule: ElectionRule): void;
    /** 是否允许选主 */
    canElect(): boolean;
    /** 设置 Swarm 在线状态（Swarm 在线时禁止选主） */
    setSwarmOnline(online: boolean): void;
    /** Set external host command (ANDLBE HostChanged / Swarm set-server). Suppresses LAN auto-election. */
    setExternalHostCommand(command: ExternalHostCommand): void;
    /** Whether an active external host command exists (suppresses auto-election) */
    hasExternalHostCommand(): boolean;
    /** 周期清理（由 TimerService 调用，或内部定时器） */
    cleanupStaleMembers(): void;
}
/**
 * 默认设备拓扑服务实现。
 *
 * 维护同房间设备拓扑表，处理选主、多 server 仲裁、超时清理。
 * 实时性优化：500ms 稳定窗口、响应式心跳、server 掉线 3s 突破冷却。
 */
export declare class DefaultDeviceTopologyService implements DeviceTopologyService {
    readonly serviceName: "deviceTopology";
    private members;
    private localDeviceId?;
    private localIp?;
    private localRoomId?;
    private localEpoch;
    private localIsServer;
    private swarmOnline;
    /** Active external host command (ANDLBE HostChanged / Swarm set-server). Suppresses LAN auto-election. */
    private externalHostCommand?;
    private externalHostCommandTimeMs;
    private static readonly EXTERNAL_COMMAND_TIMEOUT_MS;
    private lastElectionMs;
    private lastMemberChangeMs;
    private lastServerSeenMs;
    private electionRule;
    private readonly handlers;
    private heartbeatTimeoutMs;
    private stableWindowMs;
    private electionCooldownMs;
    /** 立即心跳回调（由 L3 Adapter 注入，调 C++ BroadcastHeartbeatNow） */
    private immediateHeartbeatCallback?;
    start(config: DeviceTopologyConfig): void;
    stop(): void;
    dispose(): void;
    setLocalRoom(roomId: string | undefined): void;
    announceServer(port: number, epoch: number): void;
    revokeServer(): void;
    ingestHeartbeat(payload: DeviceHeartbeatPayload): void;
    /** 多 server 仲裁：epoch 低的 server 自动降级 */
    private resolveServerConflict;
    requestElection(): ElectionResult | undefined;
    canElect(): boolean;
    setSwarmOnline(online: boolean): void;
    setExternalHostCommand(command: ExternalHostCommand): void;
    hasExternalHostCommand(): boolean;
    setElectionRule(rule: ElectionRule): void;
    setImmediateHeartbeatCallback(callback: (() => void) | undefined): void;
    /** 触发立即心跳（内部调用，由收到新设备/切房/announceServer 等场景触发） */
    private triggerImmediateHeartbeat;
    cleanupStaleMembers(): void;
    getTopology(): RoomTopology;
    onTopologyChanged(handler: (event: TopologyChangedEvent) => void): Unsubscribe;
    private hasActiveServer;
    private extractEpoch;
    private extractBatteryLevel;
    private emitChange;
}
//# sourceMappingURL=DeviceTopologyService.d.ts.map