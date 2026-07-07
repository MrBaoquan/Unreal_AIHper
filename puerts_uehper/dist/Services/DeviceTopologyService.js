"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultDeviceTopologyService = exports.BatteryPriorityElectionRule = void 0;
/**
 * 默认选主规则：电量最高优先，deviceId 字典序兜底。
 *
 * 策略：
 * 1. 电量已知（>=0）的设备优先于电量未知（<0）的设备
 * 2. 电量高的优先（保证最大可用性，Listen Server 耗电高）
 * 3. 电量相同时，deviceId 字典序小的优先（确定性）
 */
class BatteryPriorityElectionRule {
    elect(members) {
        if (members.length === 0)
            return undefined;
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
exports.BatteryPriorityElectionRule = BatteryPriorityElectionRule;
/** 空拓扑常量 */
const EMPTY_TOPOLOGY = { roomId: undefined, members: [] };
/**
 * 默认设备拓扑服务实现。
 *
 * 维护同房间设备拓扑表，处理选主、多 server 仲裁、超时清理。
 * 实时性优化：500ms 稳定窗口、响应式心跳、server 掉线 3s 突破冷却。
 */
class DefaultDeviceTopologyService {
    constructor() {
        this.serviceName = 'deviceTopology';
        this.members = new Map();
        this.localEpoch = 0;
        this.localIsServer = false;
        this.swarmOnline = false;
        this.externalHostCommandTimeMs = 0;
        this.lastElectionMs = 0;
        this.lastMemberChangeMs = 0;
        this.lastServerSeenMs = 0;
        this.electionRule = new BatteryPriorityElectionRule();
        this.handlers = new Set();
        this.heartbeatTimeoutMs = 3000;
        this.stableWindowMs = 500;
        this.electionCooldownMs = 15000;
    }
    static { this.EXTERNAL_COMMAND_TIMEOUT_MS = 10000; }
    start(config) {
        this.localDeviceId = config.localDeviceId;
        this.localIp = config.localIp;
        this.heartbeatTimeoutMs = config.heartbeatTimeoutMs ?? 3000;
        this.stableWindowMs = config.stableWindowMs ?? 500;
        this.electionCooldownMs = config.electionCooldownMs ?? 15000;
    }
    stop() {
        this.members.clear();
        this.localRoomId = undefined;
        this.localIsServer = false;
        this.localEpoch = 0;
    }
    dispose() {
        this.stop();
        this.handlers.clear();
    }
    setLocalRoom(roomId) {
        if (this.localRoomId === roomId)
            return;
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
    announceServer(port, epoch) {
        this.localEpoch = epoch;
        this.localIsServer = true;
        // 立即广播 role=server（不等周期，让其他设备尽快知道）
        this.triggerImmediateHeartbeat();
    }
    revokeServer() {
        this.localEpoch = 0;
        this.localIsServer = false;
        this.triggerImmediateHeartbeat();
    }
    ingestHeartbeat(payload) {
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
        const member = {
            deviceId: payload.deviceId,
            ip: payload.ip,
            roomId: payload.room,
            isServer,
            serverPort,
            serverEpoch,
            batteryLevel,
            lastSeenMs: Date.now(),
            metadata: payload,
        };
        if (!existing) {
            this.members.set(payload.deviceId, member);
            this.lastMemberChangeMs = Date.now();
            const previous = this.getTopology();
            this.emitChange('memberJoined', previous, payload.deviceId);
            // 响应式心跳：收到新设备，立即回播自己（不等周期）
            this.triggerImmediateHeartbeat();
        }
        else {
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
    resolveServerConflict() {
        const servers = Array.from(this.members.values()).filter((m) => m.isServer);
        if (servers.length <= 1)
            return;
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
    requestElection() {
        if (!this.canElect())
            return undefined;
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
        if (!electedId)
            return undefined;
        this.lastElectionMs = Date.now();
        this.localEpoch++;
        return {
            electedDeviceId: electedId,
            isLocal: electedId === this.localDeviceId,
            epoch: this.localEpoch,
            reason: 'noServer',
        };
    }
    canElect() {
        // 1. Swarm online - no election
        if (this.swarmOnline)
            return false;
        // 2. External host command active (ANDLBE HostChanged / Swarm set-server) - no election
        if (this.hasExternalHostCommand())
            return false;
        // 3. Local is already server - no re-election (prevent loop)
        if (this.localIsServer)
            return false;
        // 4. Has active server - no election
        if (this.hasActiveServer())
            return false;
        // 5. Topology stable window
        if (Date.now() - this.lastMemberChangeMs < this.stableWindowMs)
            return false;
        // 6. Election cooldown (break cooldown if server lost > heartbeatTimeout)
        const timeSinceServerLost = Date.now() - this.lastServerSeenMs;
        const inCooldown = Date.now() - this.lastElectionMs < this.electionCooldownMs;
        if (inCooldown && timeSinceServerLost < this.heartbeatTimeoutMs)
            return false;
        // 7. No members - no election
        if (this.members.size === 0 && !this.localDeviceId)
            return false;
        return true;
    }
    setSwarmOnline(online) {
        this.swarmOnline = online;
    }
    setExternalHostCommand(command) {
        this.externalHostCommand = command;
        this.externalHostCommandTimeMs = Date.now();
        // External command updates local server state
        if (command.role === 'server') {
            this.localIsServer = true;
        }
        else if (command.role === 'idle' || command.role === 'client') {
            this.localIsServer = false;
        }
    }
    hasExternalHostCommand() {
        if (!this.externalHostCommand)
            return false;
        // Timeout: if no update for 10s, external source is considered lost
        return Date.now() - this.externalHostCommandTimeMs < DefaultDeviceTopologyService.EXTERNAL_COMMAND_TIMEOUT_MS;
    }
    setElectionRule(rule) {
        this.electionRule = rule;
    }
    setImmediateHeartbeatCallback(callback) {
        this.immediateHeartbeatCallback = callback;
    }
    /** 触发立即心跳（内部调用，由收到新设备/切房/announceServer 等场景触发） */
    triggerImmediateHeartbeat() {
        this.immediateHeartbeatCallback?.();
    }
    cleanupStaleMembers() {
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
    getTopology() {
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
    onTopologyChanged(handler) {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }
    hasActiveServer() {
        const now = Date.now();
        for (const m of this.members.values()) {
            if (m.isServer && now - m.lastSeenMs < this.heartbeatTimeoutMs) {
                return true;
            }
        }
        return false;
    }
    extractEpoch(payload) {
        try {
            const state = typeof payload.gameState === 'string' ? JSON.parse(payload.gameState) : payload.gameState;
            return Number(state?.serverEpoch ?? 0) || 0;
        }
        catch {
            return 0;
        }
    }
    extractBatteryLevel(payload) {
        // 从 gameState 中提取电量（业务层通过 setGameState 写入）
        try {
            const state = typeof payload.gameState === 'string' ? JSON.parse(payload.gameState) : payload.gameState;
            const battery = Number(state?.batteryLevel ?? -1);
            return battery >= 0 ? battery : undefined;
        }
        catch {
            return undefined;
        }
    }
    emitChange(type, previous, affectedDeviceId) {
        const current = this.getTopology();
        const event = { type, previousTopology: previous, currentTopology: current, affectedDeviceId };
        for (const handler of Array.from(this.handlers)) {
            try {
                handler(event);
            }
            catch (error) {
                console.warn(`[DeviceTopology] handler error: ${error?.message ?? error}`);
            }
        }
    }
}
exports.DefaultDeviceTopologyService = DefaultDeviceTopologyService;
//# sourceMappingURL=DeviceTopologyService.js.map