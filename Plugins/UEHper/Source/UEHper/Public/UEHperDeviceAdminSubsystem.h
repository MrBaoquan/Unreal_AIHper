/**
 * Swarm 设备管理子系统 (UEHper 框架层)
 *
 * 负责 PICO 设备与 Swarm 管理服务的 UDP 通信：
 * - 定时 UDP 广播心跳（deviceId, ip, role, status）
 * - 监听 Swarm 下发的命令（set-server, set-client 等）
 * - 收到命令时触发 OnDeviceCommandReceived 委托，TS 业务层通过 toManualReleaseDelegate 绑定
 *
 * 协议：纯 UDP，端口 19999（与 Swarm 共用同一端口）
 * PICO 广播心跳 → Swarm 收集设备列表
 * Swarm 单播命令 → PICO 收到后回复 ack
 *
 * 框架下沉：此模块属于 UEHper 框架能力，不依赖项目业务层。
 */
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "HAL/Runnable.h"
#include <atomic>
#include "UEHperDeviceAdminSubsystem.generated.h"

class FSocket;

/** Swarm 命令结构体（从 UDP JSON 解析） */
USTRUCT(BlueprintType)
struct FSwarmCommand
{
	GENERATED_BODY()

	/** 命令类型：set-server, set-client */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString Cmd;

	/** 命令唯一ID，用于 ack 匹配 */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString ID;

	/** 当 cmd=set-client 时，服务端 IP */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString ServerIP;

	/** UE 游戏端口（set-server 监听端口 / set-client 连接端口） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 Port = 0;

	/** 所属房间名（房间分组标识） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString Room;

	/** 所属房间 ID（不可变关联标识） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 RoomId = 0;

	/** 环节动作：jump / complete / interrupt */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString Action;

	/** 目标环节索引（jump 时使用） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 SegmentIndex = 0;

	/** 目标关卡索引（jump 时使用） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 LevelIndex = 0;

	/** 命令目标设备；为空时视为广播 */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString TargetDeviceId;
};

/** 命令接收委托（TS 通过 toManualReleaseDelegate 绑定） */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSwarmCommandReceived, const FSwarmCommand&, Command);

/**
 * 设备心跳接收委托：收到同网段其他设备的心跳包时触发。
 * TS 业务层通过 DeviceTopologyService 订阅，维护同房间设备拓扑表。
 *
 * 心跳包判定：有 deviceId + ip 字段且无 cmd 字段的 UDP 包。
 * Swarm 命令包（有 cmd 字段）走 OnSwarmCommandReceived。
 *
 * @param SenderDeviceId  发送设备 ID
 * @param JsonPayload     完整心跳 JSON（含 deviceId, ip, role, room, gamePort, gameState 等）
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(
	FOnDeviceHeartbeatReceived,
	const FString&, SenderDeviceId,
	const FString&, JsonPayload
);

/**
 * 外部主机指令委托：由第三方房间系统（如 ANDLBE CYQJClientNetwork）触发。
 * 当 ANDLBE Server 下发 HostChanged/RoomHostInfo 时，CYQJClientNetwork 完成底层操作
 * （StopExistingServer/DisconnectFromOldHost）后，通过此委托通知 TS 业务层
 * 完成 OpenAsListenServer/ClientTravel 和角色状态同步。
 *
 * TS 层收到后：
 * - role="server" → WorldGameplayBridgeModule.handleElectedAsHost → OpenAsListenServer
 * - role="client" → WorldGameplayBridgeModule → ClientTravel(IP:Port)
 * - DeviceTopologyService.setExternalHostCommand → 抑制 LAN UDP 自动选主
 *
 * @param Role         "server" | "client" | "idle"
 * @param ServerIP     主机 IP（role=server 时是本机 IP，role=client 时是目标主机 IP）
 * @param GamePort     业务 Listen Server 端口
 * @param HostPlayerID 主机 PlayerID（-1 表示未知）
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(
	FOnExternalHostCommand,
	const FString&, Role,
	const FString&, ServerIP,
	int32, GamePort,
	int32, HostPlayerID
);

/**
 * Swarm 控制权接管委托：当收到 swarm-takeover 命令（含 monotonic epoch 仲裁、新 owner 信息）时触发。
 * TS 业务层订阅此委托 → 主动切换 TcpClient 到新 owner 的 swarmIp/port，实现多 Swarm 间显式接管。
 * 仲裁规则：仅当 epoch > CurrentOwnerEpoch 时才广播（单调递增），防止乱序/回放引发抖动。
 *
 * @param NewSwarmId   新 owner Swarm 标识（如 venue-A，启动参数/hostname 派生）
 * @param NewOwnerEpoch  接管序号（unix-ms，仲裁依据）
 * @param NewSwarmIp    新 owner 的 IP（TCP control 通道地址）
 * @param NewSwarmTcpPort 新 owner 的 TCP 控制端口
 */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_FourParams(
	FOnSwarmOwnerChanged,
	const FString&, NewSwarmId,
	int64, NewOwnerEpoch,
	const FString&, NewSwarmIp,
	int32, NewSwarmTcpPort
);

/**
 * Swarm 设备管理子系统
 *
 * 通过 GetSubsystem<UUEHperDeviceAdminSubsystem>() 获取。
 * TS 侧通过 OnSwarmCommandReceived 委托接收命令。
 */
UCLASS()
class UEHPER_API UUEHperDeviceAdminSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	/** 命令接收委托（TS 绑定入口） */
	UPROPERTY(BlueprintAssignable, Category = "Swarm")
	FOnSwarmCommandReceived OnSwarmCommandReceived;

	/** 设备心跳接收委托（TS DeviceTopologyService 绑定入口） */
	UPROPERTY(BlueprintAssignable, Category = "Swarm")
	FOnDeviceHeartbeatReceived OnDeviceHeartbeatReceived;

	/** 外部主机指令委托（第三方房间系统如 ANDLBE 触发，TS 业务层订阅） */
	UPROPERTY(BlueprintAssignable, Category = "Swarm")
	FOnExternalHostCommand OnExternalHostCommand;

	/** UDP 服务发现：Swarm 回复的 swarm-hello 包中携带的 Swarm 本机 IP（被 UE 看到的地址） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString LastSwarmSenderIP;

	/** UDP 服务发现：Swarm 回复的 swarm-hello 包中携带的 TCP 控制端口 */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 DiscoveredTcpPort = 0;

	/** 当前 owner Swarm 标识（首次发现后 sticky，由 swarm-takeover 显式切换） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	FString CurrentSwarmId;

	/** 当前 owner epoch（unix-ms 起点，单调递增，仲裁 swarm-takeover） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int64 CurrentOwnerEpoch = 0;

	/** 当前 owner Swarm 的 TCP 控制端口（takeover 时更新） */
	UPROPERTY(BlueprintReadOnly, Category = "Swarm")
	int32 CurrentSwarmTcpPort = 0;

	/** 控制权变更委托：收到比 CurrentOwnerEpoch 更大的 swarm-takeover 时广播 */
	UPROPERTY(BlueprintAssignable, Category = "Swarm")
	FOnSwarmOwnerChanged OnSwarmOwnerChanged;

	/**
	 * 处理 swarm-takeover 命令：epoch 仲裁后更新 owner 字段并广播 OnSwarmOwnerChanged。
	 * 由 HandleReceivedCommand 在收到 cmd=swarm-takeover 时调用。
	 * @param SenderIp   发包 Swarm 的 IP（被设备看到的源地址）
	 * @param SwarmId    新 owner 的 swarmId
	 * @param Epoch      接管 epoch（必须 > CurrentOwnerEpoch 才生效）
	 * @param TcpPort    新 owner 的 TCP 控制端口
	 * @return true 表示已切换 owner（已广播委托）；false 表示过期/相等 epoch 被忽略
	 */
	bool HandleSwarmTakeoverIfAny(const FString& SenderIp, const FString& SwarmId, int64 Epoch, int32 TcpPort);

	// ── Lifecycle ──

	/** 开始心跳广播 + 命令监听
	 *  @param DeviceId   设备标识（如 "pico-001"）
	 *  @param HeartbeatIntervalMs  心跳间隔毫秒（默认 2000）
	 *  @param Port       本地 UDP 端口（默认 19998）
	 *  @param TargetPort Swarm 服务端 UDP 端口（默认 19999，心跳发往此端口）
	 */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void StartHeartbeat(const FString& DeviceId, int32 HeartbeatIntervalMs = 2000, int32 Port = 19998, int32 TargetPort = 19999);

	/** 停止心跳和监听 */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void StopHeartbeat();

	/** 在不停心跳的前提下更新 deviceId（用于 Swarm 端冲突重分配后同步） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void UpdateDeviceId(const FString& NewDeviceId);

	/** 设置当前设备角色（下次心跳携带） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetDeviceRole(const FString& InRole);

	/** 设置当前设备状态（下次心跳携带） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetDeviceStatus(const FString& InStatus);

	/** 设置 UE 游戏端口（下次心跳携带） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetGamePort(int32 InGamePort);

	/** 设置所属房间名（下次心跳携带） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetRoom(const FString& InRoom);

	/** 设置所属房间 ID（下次心跳携带，不可变关联标识） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetRoomId(int32 InRoomId);

	/** 设置游戏状态快照 JSON（下次心跳携带，供 Swarm 观测当前环节） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SetGameState(const FString& InGameState);

	/** 立即广播一次心跳（不等 Timer 周期，用于切房/响应式发现/announceServer 等实时性场景） */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void BroadcastHeartbeatNow();

	/** 向 Swarm 发送命令确认（ACK），可携带结构化数据 */
	UFUNCTION(BlueprintCallable, Category = "Swarm")
	void SendAck(const FString& AckId, bool bOK, const FString& Message);

	/** 是否正在运行 */
	UFUNCTION(BlueprintPure, Category = "Swarm")
	bool IsRunning() const { return bRunning; }

	/** 申请设备保持唤醒，并可选将自动休眠/灭屏设置为 Never。 */
	UFUNCTION(BlueprintCallable, Category = "Device|Power")
	void EnableKeepAwake(bool bSetAutoSleepNever = true, bool bSetScreenOffNever = true);

	/** 释放保持唤醒，并恢复进入前记录的自动休眠/灭屏设置。 */
	UFUNCTION(BlueprintCallable, Category = "Device|Power")
	void DisableKeepAwake();

	/** 当前是否已请求保持唤醒。 */
	UFUNCTION(BlueprintPure, Category = "Device|Power")
	bool IsKeepAwakeEnabled() const { return bKeepAwakeRequested; }

	/** 获取本机局域网 IP */
	UFUNCTION(BlueprintPure, Category = "Swarm")
	static FString GetLocalIPAddress();

	// ── UGameInstanceSubsystem ──
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

private:
	/** UDP 收发工作线程 */
	class FDeviceAdminWorker : public FRunnable
	{
	public:
		FDeviceAdminWorker(UUEHperDeviceAdminSubsystem* InOwner, int32 InPort, int32 InTargetPort);
		virtual ~FDeviceAdminWorker() override;

		virtual uint32 Run() override;
		virtual void Stop() override;

		void EnqueueHeartbeat(const FString& JsonPayload);
		void EnqueueAck(const FString& AckId, bool bOK, const FString& Message);

	private:
		UUEHperDeviceAdminSubsystem* Owner;
		int32 Port;        // 本地绑定端口
		int32 TargetPort;  // Swarm 服务端端口（心跳发往此端口）
		FSocket* Socket = nullptr;
		TArray<uint8> RecvBuffer;
		std::atomic<bool> bShouldRun{false};

		struct FOutPacket { TArray<uint8> Data; };
		TQueue<FOutPacket, EQueueMode::Spsc> SendQueue;

		bool TryBind();
		void ProcessReceive();
		void ProcessSend();
		void ReleaseSocket();
	};

private:
	FDeviceAdminWorker* Worker = nullptr;
	FRunnableThread* WorkerThread = nullptr;
	FTimerHandle HeartbeatTimerHandle;
	bool bRunning = false;

	FString DeviceId;
	FString DeviceRole = TEXT("idle");
	FString DeviceStatus = TEXT("running");
	FString DeviceRoom;
	int32 DeviceRoomId = 0;
	FString DeviceGameState;        // JSON：{currentSegment,segmentIndex,matchPhase}
	int32 GamePort = 7777;
	int32 UDPPort = 19998;
	int32 TargetPort = 19999;
	bool bKeepAwakeRequested = false;
	bool bKeepAwakeApplied = false;
	bool bPicoTobBinding = false;
	bool bPicoTobBound = false;
	bool bKeepAwakeSetAutoSleepNever = true;
	bool bKeepAwakeSetScreenOffNever = true;
	bool bHasCachedSleepDelay = false;
	bool bHasCachedScreenOffDelay = false;
	int32 CachedSleepDelay = -1;
	int32 CachedScreenOffDelay = -1;

	void BroadcastHeartbeat();
	void HandleReceivedCommand(const FString& JsonStr, const FString& SenderIP);
	void ApplyKeepAwakeSettings();
	void CacheKeepAwakePolicy();
	void RestoreKeepAwakePolicy();

	UFUNCTION()
	void HandlePicoTobServiceBound(bool bResult);

	UFUNCTION()
	void HandleSetScreenOffDelayResult(int32 Result);
};
