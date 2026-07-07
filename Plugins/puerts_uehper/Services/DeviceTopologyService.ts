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
export class BatteryPriorityElectionRule implements ElectionRule {
    elect(members: readonly DeviceMember[]): string | undefined {
        if (members.length === 0) return undefined;
        const sorted = [...members].sort((a, b) => {
            const batteryA = a.batteryLevel ?? -1;
            const batteryB = b.batteryLevel ?? -1;
            if (batteryA !== batteryB) {
                return batteryB - batteryA;
            }
            return a.deviceId.localeCompare(b.deviceId, 'zh-Hans-CN');
        });
        return sorted[0]?.deviceId;
    }
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

/** 空拓扑常量 */
const EMPTY_TOPOLOGY: RoomTopology = { roomId: undefined, members: [] };

/**
 * 默认设备拓扑服务实现。
 *
 * 维护同房间设备拓扑表，处理选主、多 server 仲裁、超时清理。
 * 实时性优化：500ms 稳定窗口、响应式心跳、server 掉线 3s 突破冷却。
 */
export class DefaultDeviceTopologyService implements DeviceTopologyService {
    readonly serviceName = 'deviceTopology' as const;

    private members = new Map<string, DeviceMember>();
    private localDeviceId?: string;
    private localIp?: string;
    private localRoomId?: string;
    private localEpoch = 0;
    private localIsServer = false;
    private swarmOnline = false;
    /** Active external host command (ANDLBE HostChanged / Swarm set-server). Suppresses LAN auto-election. */
    private externalHostCommand?: ExternalHostCommand;
    private externalHostCommandTimeMs = 0;
    private static readonly EXTERNAL_COMMAND_TIMEOUT_MS = 10000;
    private lastElectionMs = 0;
    private lastMemberChangeMs = 0;
    private lastServerSeenMs = 0;
    private electionRule: ElectionRule = new BatteryPriorityElectionRule();
    private readonly handlers = new Set<(event: TopologyChangedEvent) => void>();

    private heartbeatTimeoutMs = 3000;
    private stableWindowMs = 500;
    private electionCooldownMs = 15000;
    /** 立即心跳回调（由 L3 Adapter 注入，调 C++ BroadcastHeartbeatNow） */
    private immediateHeartbeatCallback?: () => void;

    start(config: DeviceTopologyConfig): void {
        this.localDeviceId = config.localDeviceId;
        this.localIp = config.localIp;
        this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 3000;
        this.stableWindowMs = config.stableWindowMs ?? 500;
        this.electionCooldownMs = config.electionCooldownMs ?? 15000;
    }

    stop(): void {
        this.members.clear();
        this.localRoomId = undefined;
        this.localIsServer = false;
        this.localEpoch = 0;
    }

    dispose(): void {
        this.stop();
        this.handlers.clear();
    }

    setLocalRoom(roomId: string | undefined): void {
        if (this.localRoomId === roomId) return;
        const previous = this.getTopology();
        this.localRoomId = roomId;
        // 切房时清空旧房间拓扑，重置选主状态
        this.members.clear();
        this.lastElectionMs = 0;
        this.lastServerSeenMs = 0;
        this.lastMemberChangeMs = Date.now();
        this.localIsServer = false;
        this.localEpoch = 0;
        this.emitChange('roomChanged', previous, undefined);
        // 立即广播新房间的自身心跳（不等周期）
        this.triggerImmediateHeartbeat();
    }

    announceServer(port: number, epoch: number): void {
        this.localEpoch = epoch;
        this.localIsServer = true;
        // 立即广播 role=server（不等周期，让其他设备尽快知道）
        this.triggerImmediateHeartbeat();
    }

    revokeServer(): void {
        this.localEpoch = 0;
        this.localIsServer = false;
        this.triggerImmediateHeartbeat();
    }

    ingestHeartbeat(payload: DeviceHeartbeatPayload): void {
        // 1. 房间过滤：只接受同房间的心跳（本机未设房间时接受所有）
        if (this.localRoomId && payload.room && payload.room !== this.localRoomId) {
            return;
        }

        // 2. 忽略自己的心跳回环
        if (payload.deviceId === this.localDeviceId) {
            return;
        }

        // 3. 解析 isServer + epoch + battery
        const isServer = payload.role === 'server';
        const serverPort = payload.gamePort;
        const serverEpoch = isServer ? this.extractEpoch(payload) : undefined;
        const batteryLevel = this.extractBatteryLevel(payload);

        // 4. 更新或新增成员
        const existing = this.members.get(payload.deviceId);
        const member: DeviceMember = {
            deviceId: payload.deviceId,
            ip: payload.ip,
            roomId: payload.room,
            isServer,
            serverPort,
            serverEpoch,
            batteryLevel,
            lastSeenMs: Date.now(),
            metadata: payload as Record<string, unknown>,
        };

        if (!existing) {
            this.members.set(payload.deviceId, member);
            this.lastMemberChangeMs = Date.now();
            const previous = this.getTopology();
            this.emitChange('memberJoined', previous, payload.deviceId);
            // 响应式心跳：收到新设备，立即回播自己（不等周期）
            this.triggerImmediateHeartbeat();
        } else {
            const serverChanged = existing.isServer !== isServer || existing.serverEpoch !== serverEpoch;
            this.members.set(payload.deviceId, member);
            if (isServer) {
                this.lastServerSeenMs = Date.now();
            }
            if (serverChanged) {
                const previous = this.getTopology();
                this.emitChange('serverChanged', previous, payload.deviceId);
            }
        }

        // 5. 多 server 仲裁
        this.resolveServerConflict();
    }

    /** 多 server 仲裁：epoch 低的 server 自动降级 */
    private resolveServerConflict(): void {
        const servers = Array.from(this.members.values()).filter((m) => m.isServer);
        if (servers.length <= 1) return;

        // 找到 max(epoch) 的 server
        const authoritativeServer = servers.reduce((max, m) => ((m.serverEpoch ?? 0) > (max.serverEpoch ?? 0) ? m : max));

        // 其他 epoch 更低的 server 视为过时
        for (const s of servers) {
            if (s.deviceId !== authoritativeServer.deviceId) {
                this.members.set(s.deviceId, { ...s, isServer: false, serverEpoch: undefined });
                // 如果是自己（本机是过时 server），自动降级
                if (s.deviceId === this.localDeviceId) {
                    this.revokeServer();
                }
            }
        }
    }

    requestElection(): ElectionResult | undefined {
        if (!this.canElect()) return undefined;

        const members = Array.from(this.members.values());
        // 加入本机自身（本机也在房间内，但心跳不回环给自己）
        if (this.localDeviceId && this.localIp) {
            members.push({
                deviceId: this.localDeviceId,
                ip: this.localIp,
                roomId: this.localRoomId,
                isServer: this.localIsServer,
                serverEpoch: this.localEpoch || undefined,
                batteryLevel: undefined,
                lastSeenMs: Date.now(),
            });
        }

        const electedId = this.electionRule.elect(members);
        if (!electedId) return undefined;

        this.lastElectionMs = Date.now();
        this.localEpoch++;
        return {
            electedDeviceId: electedId,
            isLocal: electedId === this.localDeviceId,
            epoch: this.localEpoch,
            reason: 'noServer',
        };
    }

    canElect(): boolean {
        // 1. Swarm online - no election
        if (this.swarmOnline) return false;
        // 2. External host command active (ANDLBE HostChanged / Swarm set-server) - no election
        if (this.hasExternalHostCommand()) return false;
        // 3. Local is already server - no re-election (prevent loop)
        if (this.localIsServer) return false;
        // 4. Has active server - no election
        if (this.hasActiveServer()) return false;
        // 5. Topology stable window
        if (Date.now() - this.lastMemberChangeMs < this.stableWindowMs) return false;
        // 6. Election cooldown (break cooldown if server lost > heartbeatTimeout)
        const timeSinceServerLost = Date.now() - this.lastServerSeenMs;
        const inCooldown = Date.now() - this.lastElectionMs < this.electionCooldownMs;
        if (inCooldown && timeSinceServerLost < this.heartbeatTimeoutMs) return false;
        // 7. No members - no election
        if (this.members.size === 0 && !this.localDeviceId) return false;
        return true;
    }

    setSwarmOnline(online: boolean): void {
        this.swarmOnline = online;
    }

    setExternalHostCommand(command: ExternalHostCommand): void {
        this.externalHostCommand = command;
        this.externalHostCommandTimeMs = Date.now();
        // External command updates local server state
        if (command.role === 'server') {
            this.localIsServer = true;
        } else if (command.role === 'idle' || command.role === 'client') {
            this.localIsServer = false;
        }
    }

    hasExternalHostCommand(): boolean {
        if (!this.externalHostCommand) return false;
        // Timeout: if no update for 10s, external source is considered lost
        return Date.now() - this.externalHostCommandTimeMs < DefaultDeviceTopologyService.EXTERNAL_COMMAND_TIMEOUT_MS;
    }

    setElectionRule(rule: ElectionRule): void {
        this.electionRule = rule;
    }

    setImmediateHeartbeatCallback(callback: (() => void) | undefined): void {
        this.immediateHeartbeatCallback = callback;
    }

    /** 触发立即心跳（内部调用，由收到新设备/切房/announceServer 等场景触发） */
    private triggerImmediateHeartbeat(): void {
        this.immediateHeartbeatCallback?.();
    }

    cleanupStaleMembers(): void {
        const now = Date.now();
        let changed = false;
        let serverLost = false;
        for (const [deviceId, member] of this.members) {
            if (now - member.lastSeenMs > this.heartbeatTimeoutMs) {
                this.members.delete(deviceId);
                changed = true;
                if (member.isServer) {
                    serverLost = true;
                }
            }
        }
        if (changed) {
            this.lastMemberChangeMs = now;
            const previous = this.getTopology();
            this.emitChange('memberLeft', previous, undefined);
        }
        // server 掉线时不立即选主，等下次 canElect 检查（稳定窗口 + 冷却突破）
        void serverLost;
    }

    getTopology(): RoomTopology {
        const members = Array.from(this.members.values());
        const server = members.find((m) => m.isServer && Date.now() - m.lastSeenMs < this.heartbeatTimeoutMs);
        return {
            roomId: this.localRoomId,
            members,
            serverDeviceId: server?.deviceId,
            serverIp: server?.ip,
            serverPort: server?.serverPort,
            serverEpoch: server?.serverEpoch,
        };
    }

    onTopologyChanged(handler: (event: TopologyChangedEvent) => void): Unsubscribe {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    private hasActiveServer(): boolean {
        const now = Date.now();
        for (const m of this.members.values()) {
            if (m.isServer && now - m.lastSeenMs < this.heartbeatTimeoutMs) {
                return true;
            }
        }
        return false;
    }

    private extractEpoch(payload: DeviceHeartbeatPayload): number {
        try {
            const state = typeof payload.gameState === 'string' ? JSON.parse(payload.gameState) : payload.gameState;
            return Number(state?.serverEpoch ?? 0) || 0;
        } catch {
            return 0;
        }
    }

    private extractBatteryLevel(payload: DeviceHeartbeatPayload): number | undefined {
        // 从 gameState 中提取电量（业务层通过 setGameState 写入）
        try {
            const state = typeof payload.gameState === 'string' ? JSON.parse(payload.gameState) : payload.gameState;
            const battery = Number(state?.batteryLevel ?? -1);
            return battery >= 0 ? battery : undefined;
        } catch {
            return undefined;
        }
    }

    private emitChange(type: TopologyEventType, previous: RoomTopology, affectedDeviceId?: string): void {
        const current = this.getTopology();
        const event: TopologyChangedEvent = { type, previousTopology: previous, currentTopology: current, affectedDeviceId };
        for (const handler of Array.from(this.handlers)) {
            try {
                handler(event);
            } catch (error) {
                console.warn(`[DeviceTopology] handler error: ${(error as Error)?.message ?? error}`);
            }
        }
    }
}