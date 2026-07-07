/**
 * UEHper TCP 客户端 (P3-A 新增)
 *
 * Swarm 控制协议的 TCP 控制通道客户端，UE 主动连接 Swarm controlPort。
 * 承载 Envelope 消息收发（command/ack/result/state/ping/pong），JSON Lines 格式。
 *
 * 设计原则（roadmap Section 8）：
 * - UE → Swarm 主动连接：PICO 设备 NAT/防火墙友好，Swarm 无需主动连设备。
 * - JSON Lines 协议：每行一个 JSON Envelope，\n 分隔，实现简单、日志可读。
 * - 自动重连：TCP 断开后指数退避重连（1s/2s/4s/8s，上限 30s）。
 * - ping/pong 保活：30 秒间隔，超时 60 秒判定连接断开。
 *
 * 与 UDP 的关系（roadmap Section 8.4）：
 * - TCP 连接建立后，Swarm 优先走 TCP 下发命令。
 * - TCP 断开立即降级 UDP（DeviceAdminAdapter 的 UDP 链路保留为 fallback）。
 * - UDP hello 始终广播（无论是否有 TCP 连接），Swarm 据此判断设备存活。
 *
 * 线程模型：
 * - 后台 FRunnable 线程负责 socket 读写（避免阻塞游戏线程）。
 * - 收到数据后 AsyncTask 切回游戏线程，解析 JSON 触发 OnEnvelopeReceived 委托。
 *
 * 框架下沉：此模块属于 UEHper 框架能力，不依赖项目业务层。
 */
#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "Sockets.h"
#include <atomic>
#include "UEHperTcpClient.generated.h"

/** Envelope 接收委托（TS 通过 toManualReleaseDelegate 绑定） */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnTcpEnvelopeReceived, const FString&, JsonLine);

/** 连接状态变更委托 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTcpConnectionStateChanged, bool, bConnected, const FString&, Reason);

/** 设备 ID 由 Swarm 分配/确认事件：RequestedDeviceId 为本地提示 ID，AssignedDeviceId 为 Swarm 最终生效 ID */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTcpDeviceIdAssigned, const FString&, RequestedDeviceId, const FString&, AssignedDeviceId);

/**
 * UEHper TCP 客户端
 *
 * 通过 Start() 启动后，后台线程主动连接 Swarm controlPort，
 * 建立 TCP 连接后双向收发 JSON Lines 格式的 Envelope 消息。
 *
 * 使用方式：
 *   1. 创建实例：UTcpClient* TcpClient = NewObject<UTcpClient>();
 *   2. 绑定委托：TcpClient->OnEnvelopeReceived.AddDynamic(...);
 *   3. 启动连接：TcpClient->Start("192.168.1.100", 20001);
 *   4. 发送消息：TcpClient->SendEnvelope(JsonString);
 *   5. 停止：TcpClient->Stop();
 */
UCLASS(Transient)
class UEHPER_API UUEHperTcpClient : public UObject, public FRunnable
{
    GENERATED_BODY()

public:
    UUEHperTcpClient();

    /** Envelope 接收委托（每行一个 JSON） */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|TCP")
    FOnTcpEnvelopeReceived OnEnvelopeReceived;

    /** 连接状态变更委托 */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|TCP")
    FOnTcpConnectionStateChanged OnConnectionStateChanged;

    /** Swarm 分配/确认 deviceId 委托（在 register-ack 收到时触发） */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|TCP")
    FOnTcpDeviceIdAssigned OnDeviceIdAssigned;

    /** Swarm 最终分配的设备 ID（register-ack 后才有效；未确认前等于 LocalDeviceId） */
    UPROPERTY(BlueprintReadOnly, Category = "UEHper|TCP")
    FString AssignedDeviceId;

    /**
     * 启动 TCP 客户端，连接 Swarm controlPort。
     * @param Host Swarm 服务端 IP
     * @param Port Swarm TCP 控制端口
     * @param DeviceId 本设备 ID（用于 register 消息）
     */
    UFUNCTION(BlueprintCallable, Category = "UEHper|TCP")
    void Start(const FString& Host, int32 Port, const FString& DeviceId);

    /** 停止 TCP 客户端，断开连接 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|TCP")
    void ShutdownTcp();

    /** 发送 JSON Lines 消息（自动追加 \n） */
    UFUNCTION(BlueprintCallable, Category = "UEHper|TCP")
    bool SendEnvelope(const FString& JsonLine);

    /** 是否已连接 */
    UFUNCTION(BlueprintPure, Category = "UEHper|TCP")
    bool IsConnected() const { return bConnected.load(); }

    /** P4-F: 设置 HMAC 共享密钥（用于验证 Swarm 发送的 SignedEnvelope） */
    UFUNCTION(BlueprintCallable, Category = "UEHper|TCP")
    void SetHMACSecret(const FString& InSecret);

    // ── FRunnable ──
    virtual uint32 Run() override;
    virtual void Stop() override;

private:
    /** 后台线程主循环：连接 → 收发 → 重连 */
    void RunLoop();

    /** 尝试连接 Swarm */
    bool TryConnect();

    /** 处理接收：读取 socket，按 \n 分割 JSON Lines */
    void ProcessReceive();

    /** 处理发送：从发送队列取出消息发送 */
    void ProcessSend();

    /** 发送 ping 保活 */
    void ProcessPing();

    /** 释放 socket */
    void ReleaseSocket();

    /** 通知连接状态变更（游戏线程） */
    void NotifyConnectionState(bool bNewConnected, const FString& Reason);

    /** 发送 register 消息（连接建立后） */
    void SendRegister();

    /** 在收到 register-ack 时解析 Swarm 分配的 deviceId，更新 AssignedDeviceId 并触发委托 */
    void HandleRegisterAckIfAny(const FString& JsonLine);

    FSocket* Socket = nullptr;
    FRunnableThread* Thread = nullptr;
    std::atomic<bool> bShouldRun{false};
    std::atomic<bool> bConnected{false};

    FString RemoteHost;
    int32 RemotePort = 0;
    FString LocalDeviceId;

    /** 接收缓冲区（跨包拼接不完整的 JSON Line） */
    TArray<uint8> RecvBuffer;
    /** 累积一行的原始 UTF-8 字节，遇 \n 时整体用 UTF8_TO_TCHAR 解码。
     *  不可逐字节 (TCHAR)Ch 追加，否则中文等 UTF-8 多字节会被 Latin-1 误解码成乱码。 */
    TArray<uint8> LineBytes;

    /** 发送队列 */
    FCriticalSection SendQueueLock;
    TArray<FString> SendQueue;

    /** ping/pong 计时 */
    double LastPingTime = 0.0;
    double LastPongTime = 0.0;
    /**
     * TCP 双向保活协议（与 Swarm/cmd/swarm/tcp_server.go 中 tcpPingInterval / tcpPongTimeout 对齐）：
     *  - 本端 ProcessPing 每 PingIntervalSec 写一次 "ping"，Swarm 回 "pong"
     *  - 本端 ProcessReceive 收到 Swarm 的 "ping" 也要回 "pong\n"，否则 60s 后 Swarm 主动断连
     *  - 任何 "pong" 或对端 "ping" 都会刷新 LastPongTime
     * 修改这两个常量请同步 Swarm 侧 tcpPingInterval / tcpPongTimeout。
     */
    static constexpr double PingIntervalSec = 30.0;
    static constexpr double PongTimeoutSec = 60.0;

    /** 重连退避 */
    double NextReconnectTime = 0.0;
    int32 ReconnectAttempt = 0;
    static constexpr int32 MaxReconnectBackoffSec = 30;

    /** P4-F: HMAC 共享密钥（与 Swarm 一致） */
    FString HMACSecret;
    /** P4-F: nonce 去重缓存（防重放） */
    TSet<FString> NonceCache;
    /** P4-F: nonce 缓存上限 */
    static constexpr int32 MaxNonceCacheSize = 1000;
    /** P4-F: timestamp 窗口（毫秒，±5 分钟） */
    static constexpr int64 HMACTimestampWindowMs = 5 * 60 * 1000;

    /** P4-F: 验证 SignedEnvelope 的 HMAC 签名（nonce + timestamp + signature） */
    bool VerifyHMAC(const FString& Nonce, int64 Timestamp, const FString& PayloadJson, const FString& Signature);

    /** P4-F: 计算 HMAC-SHA256 签名 */
    FString ComputeHMAC(const FString& Nonce, int64 Timestamp, const FString& PayloadJson);
};
