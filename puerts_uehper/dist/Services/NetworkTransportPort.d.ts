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
/** Envelope 消息类型（与 roadmap Section 3.1 一致；capabilities 用于设备向 Swarm 上报可执行的动态命令清单） */
export type EnvelopeType = 'hello' | 'command' | 'ack' | 'result' | 'state' | 'capabilities' | 'error' | 'ping' | 'pong';
/** 协议版本 */
export declare const PROTOCOL_VERSION = 2;
/** Swarm 控制协议 Envelope（与 roadmap Section 3.1 一义） */
export interface SwarmEnvelope {
    readonly type: EnvelopeType;
    readonly protocolVersion: number;
    readonly deviceId: string;
    readonly roomId: string;
    readonly sessionId: string;
    readonly worldId?: string;
    readonly targetScope?: 'session' | 'world' | 'level';
    readonly commandId: string;
    readonly seq: number;
    readonly ttlMs: number;
    readonly issuedAt: number;
    readonly name: string;
    readonly params: Readonly<Record<string, unknown>>;
}
/** 取消订阅函数 */
export type TransportUnsubscribe = () => void;
/** Envelope 接收处理器 */
export type EnvelopeHandler = (envelope: SwarmEnvelope) => void;
/** 连接状态（与 roadmap Section 8.4 controlChannel 状态机一致） */
export type TransportConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
/** 连接状态变更事件 */
export interface TransportConnectionChangedEvent {
    readonly previous: TransportConnectionState;
    readonly current: TransportConnectionState;
    readonly reason?: string;
}
/**
 * NetworkTransportPort - Swarm 控制面网络通道抽象接口。
 *
 * 实现类挂在 rootContext.services（root-scoped），跨 World 持久。
 * World 层通过 context.rootServices.getService<NetworkTransportPort>('networkTransport') 获取。
 */
export interface NetworkTransportPort {
    /** 传输类型 ID（'udp' | 'tcp' | 'mock'） */
    readonly transportId: string;
    /** 启动传输（建立连接/开始监听） */
    start(config: TransportConfig): Promise<void>;
    /** 停止传输（断开连接/停止监听） */
    stop(): Promise<void>;
    /** 发送 Envelope 消息 */
    send(envelope: SwarmEnvelope): void;
    /** 广播 hello 消息（UDP 广播专用，TCP/Mock 可降级为 send） */
    broadcastHello(hello: SwarmEnvelope): void;
    /** 注册 Envelope 接收处理器 */
    onEnvelope(handler: EnvelopeHandler): TransportUnsubscribe;
    /** 注册连接状态变更处理器 */
    onConnectionStateChanged(handler: (event: TransportConnectionChangedEvent) => void): TransportUnsubscribe;
    /** 查询当前连接状态 */
    getConnectionState(): TransportConnectionState;
    /** 是否已连接（connected 状态） */
    isConnected(): boolean;
}
/** 传输配置（由 SessionModule 根据设备配置传入） */
export interface TransportConfig {
    /** 设备 ID */
    readonly deviceId: string;
    /** Swarm 服务端 IP（UDP 单播/TCP 连接目标） */
    readonly swarmHost: string;
    /** Swarm UDP 端口 */
    readonly swarmPort: number;
    /** 本地监听端口（接收 Swarm 命令） */
    readonly listenPort: number;
    /** 心跳间隔（毫秒） */
    readonly heartbeatIntervalMs: number;
    /** 心跳超时（毫秒） */
    readonly heartbeatTimeoutMs: number;
    /** 可选：TCP 控制端口（P2 阶段启用） */
    readonly tcpControlPort?: number;
    /** P4-F: HMAC 共享密钥（与 Swarm 一致，用于验签） */
    readonly hmacSecret?: string;
}
/**
 * MockNetworkTransport - 本地调试实现（L2 框架底座）。
 *
 * 无真实网络，所有 send 的消息通过 onEnvelope 回调本地回环。
 * 用于无 Swarm 环境的本地开发和单元测试。
 */
export declare class MockNetworkTransport implements NetworkTransportPort {
    readonly transportId = "mock";
    private connectionState;
    private readonly envelopeHandlers;
    private readonly connectionHandlers;
    private started;
    start(_config: TransportConfig): Promise<void>;
    stop(): Promise<void>;
    send(envelope: SwarmEnvelope): void;
    broadcastHello(hello: SwarmEnvelope): void;
    onEnvelope(handler: EnvelopeHandler): TransportUnsubscribe;
    onConnectionStateChanged(handler: (event: TransportConnectionChangedEvent) => void): TransportUnsubscribe;
    getConnectionState(): TransportConnectionState;
    isConnected(): boolean;
    /** 测试辅助：模拟从 Swarm 收到命令 */
    simulateIncoming(envelope: SwarmEnvelope): void;
    private setConnectionState;
}
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
export declare class UeHperUdpTransport implements NetworkTransportPort {
    readonly transportId = "udp";
    private connectionState;
    private readonly envelopeHandlers;
    private readonly connectionHandlers;
    private sendHandler?;
    private broadcastHandler?;
    start(_config: TransportConfig): Promise<void>;
    stop(): Promise<void>;
    send(envelope: SwarmEnvelope): void;
    broadcastHello(hello: SwarmEnvelope): void;
    onEnvelope(handler: EnvelopeHandler): TransportUnsubscribe;
    onConnectionStateChanged(handler: (event: TransportConnectionChangedEvent) => void): TransportUnsubscribe;
    getConnectionState(): TransportConnectionState;
    isConnected(): boolean;
    /**
     * P2-B: 注入业务层的发送处理器（DeviceAdminAdapter 的 SendAck 等）。
     * 由 WorldGameplayBridgeModule 在 start 阶段注入。
     */
    setSendHandler(handler: (envelope: SwarmEnvelope) => void): void;
    /**
     * P2-B: 注入业务层的广播处理器（DeviceAdminAdapter 的心跳广播）。
     */
    setBroadcastHandler(handler: (envelope: SwarmEnvelope) => void): void;
    /**
     * P2-B: 通知收到 Envelope（由 DeviceAdminAdapter 在 OnSwarmCommandReceived 时调用）。
     * 将原始 SwarmCommand 转换为 SwarmEnvelope 后通知所有订阅者。
     */
    notifyIncoming(envelope: SwarmEnvelope): void;
    private setConnectionState;
}
//# sourceMappingURL=NetworkTransportPort.d.ts.map