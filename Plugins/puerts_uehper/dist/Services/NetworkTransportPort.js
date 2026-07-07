"use strict";
/**
 * NetworkTransportPort - Swarm 控制面网络通道抽象（P0-A 新增）。
 *
 * 职责：
 * - 抽象 Swarm 控制面通信通道（UDP/TCP/Mock），框架底座只提供 UDP 和 Mock 实现。
 * - 承载 Envelope 消息收发（command/ack/result/state/hello/ping/pong）。
 *
 * 设计原则：
 * - 框架底座零第三方依赖（roadmap Section 0.2 第 4 条）：不 import 任何 ANDLBE 类型。
 * - 此抽象仅用于 Swarm 控制面通信，ANDLBE 网络通道由 L3 LbeMultiplayerAdapter 现有实现承担，不纳入此抽象。
 *
 * 落点：L2 puerts_uehper/Services/（root-scoped，跨 World 持久）。
 *
 * 演进路径（roadmap Section 11）：
 * - P0：UeHperUdpTransport（UDP 单播命令 + UDP 广播 hello）。
 * - P2：UeHperTcpTransport（TCP 控制通道，UE 主动连接 Swarm controlPort）。
 * - Mock：MockNetworkTransport（本地调试，无真实网络）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UeHperUdpTransport = exports.MockNetworkTransport = exports.PROTOCOL_VERSION = void 0;
/** 协议版本 */
exports.PROTOCOL_VERSION = 2;
/**
 * MockNetworkTransport - 本地调试实现（L2 框架底座）。
 *
 * 无真实网络，所有 send 的消息通过 onEnvelope 回调本地回环。
 * 用于无 Swarm 环境的本地开发和单元测试。
 */
class MockNetworkTransport {
    constructor() {
        this.transportId = 'mock';
        this.connectionState = 'disconnected';
        this.envelopeHandlers = new Set();
        this.connectionHandlers = new Set();
        this.started = false;
    }
    async start(_config) {
        this.started = true;
        this.setConnectionState('connected', 'mock-start');
    }
    async stop() {
        this.started = false;
        this.setConnectionState('disconnected', 'mock-stop');
    }
    send(envelope) {
        if (!this.started) {
            console.warn('[transport:mock] send called before start, dropping envelope');
            return;
        }
        // 本地回环：直接回调所有订阅者
        this.envelopeHandlers.forEach((handler) => {
            try {
                handler(envelope);
            }
            catch (error) {
                console.warn(`[transport:mock] envelope handler threw: ${error?.stack ?? error}`);
            }
        });
    }
    broadcastHello(hello) {
        this.send(hello);
    }
    onEnvelope(handler) {
        this.envelopeHandlers.add(handler);
        return () => this.envelopeHandlers.delete(handler);
    }
    onConnectionStateChanged(handler) {
        this.connectionHandlers.add(handler);
        return () => this.connectionHandlers.delete(handler);
    }
    getConnectionState() {
        return this.connectionState;
    }
    isConnected() {
        return this.connectionState === 'connected';
    }
    /** 测试辅助：模拟从 Swarm 收到命令 */
    simulateIncoming(envelope) {
        this.send(envelope);
    }
    setConnectionState(state, reason) {
        if (this.connectionState === state) {
            return;
        }
        const previous = this.connectionState;
        this.connectionState = state;
        const event = { previous, current: state, reason };
        this.connectionHandlers.forEach((handler) => {
            try {
                handler(event);
            }
            catch (error) {
                console.warn(`[transport:mock] connection handler threw: ${error?.stack ?? error}`);
            }
        });
    }
}
exports.MockNetworkTransport = MockNetworkTransport;
/**
 * UeHperUdpTransport - UDP 传输默认实现（L2 框架底座）。
 *
 * P2-B 实现：本类是 NetworkTransportPort 的 Envelope 视图适配器。
 * 实际 UDP 收发由 UEHper C++ UUEHperDeviceAdminSubsystem 承担（通过 DeviceAdminAdapter 封装），
 * 本类不直接操作 C++ socket，而是提供 Envelope 层级的抽象视图，供 SessionModule 等消费。
 *
 * 设计原则：
 * - 框架底座零 UE 依赖：本类不 import 'ue'，不直接调用 UE API。
 *   实际 UE 适配由业务层 DeviceAdminAdapter（L3）注入回调完成。
 * - 不重复封装：不重新实现 DeviceAdminAdapter 的 UDP 收发，只做 Envelope 视图转换。
 * - 可独立运行：无 DeviceAdminAdapter 注入时降级为日志模式（框架底座可独立运行）。
 *
 * 使用方式：
 *   业务层创建 UeHperUdpTransport 后，通过 setCommandHandler 注入 DeviceAdminAdapter 的命令回调，
 *   通过 notifyIncoming 通知收到的 Envelope。
 */
class UeHperUdpTransport {
    constructor() {
        this.transportId = 'udp';
        this.connectionState = 'disconnected';
        this.envelopeHandlers = new Set();
        this.connectionHandlers = new Set();
    }
    async start(_config) {
        // 实际启动由业务层 DeviceAdminAdapter.startWithWorld 完成
        // 此处只标记连接状态，实际 UDP 连接由 C++ UUEHperDeviceAdminSubsystem 管理
        this.setConnectionState('connected', 'udp-start');
    }
    async stop() {
        this.setConnectionState('disconnected', 'udp-stop');
    }
    send(envelope) {
        // 委托给业务层注入的 sendHandler（DeviceAdminAdapter 的 SendAck 等）
        if (this.sendHandler) {
            this.sendHandler(envelope);
        }
        else {
            console.log(`[transport:udp] send (no handler) envelope type=${envelope.type} commandId=${envelope.commandId}`);
        }
    }
    broadcastHello(hello) {
        // 委托给业务层注入的 broadcastHandler（DeviceAdminAdapter 的心跳）
        if (this.broadcastHandler) {
            this.broadcastHandler(hello);
        }
        else {
            console.log(`[transport:udp] broadcastHello (no handler) deviceId=${hello.deviceId}`);
        }
    }
    onEnvelope(handler) {
        this.envelopeHandlers.add(handler);
        return () => this.envelopeHandlers.delete(handler);
    }
    onConnectionStateChanged(handler) {
        this.connectionHandlers.add(handler);
        return () => this.connectionHandlers.delete(handler);
    }
    getConnectionState() {
        return this.connectionState;
    }
    isConnected() {
        return this.connectionState === 'connected';
    }
    /**
     * P2-B: 注入业务层的发送处理器（DeviceAdminAdapter 的 SendAck 等）。
     * 由 WorldGameplayBridgeModule 在 start 阶段注入。
     */
    setSendHandler(handler) {
        this.sendHandler = handler;
    }
    /**
     * P2-B: 注入业务层的广播处理器（DeviceAdminAdapter 的心跳广播）。
     */
    setBroadcastHandler(handler) {
        this.broadcastHandler = handler;
    }
    /**
     * P2-B: 通知收到 Envelope（由 DeviceAdminAdapter 在 OnSwarmCommandReceived 时调用）。
     * 将原始 SwarmCommand 转换为 SwarmEnvelope 后通知所有订阅者。
     */
    notifyIncoming(envelope) {
        this.envelopeHandlers.forEach((handler) => {
            try {
                handler(envelope);
            }
            catch (error) {
                console.warn(`[transport:udp] envelope handler threw: ${error?.stack ?? error}`);
            }
        });
    }
    setConnectionState(state, reason) {
        if (this.connectionState === state) {
            return;
        }
        const previous = this.connectionState;
        this.connectionState = state;
        const event = { previous, current: state, reason };
        this.connectionHandlers.forEach((handler) => {
            try {
                handler(event);
            }
            catch (error) {
                console.warn(`[transport:udp] connection handler threw: ${error?.stack ?? error}`);
            }
        });
    }
}
exports.UeHperUdpTransport = UeHperUdpTransport;
//# sourceMappingURL=NetworkTransportPort.js.map