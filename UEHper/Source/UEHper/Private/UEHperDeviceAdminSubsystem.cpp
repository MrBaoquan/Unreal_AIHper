/**
 * Swarm 设备管理子系统实现
 *
 * UDP 收发逻辑：
 * - 后台 FRunnable 线程负责 socket 读写（避免阻塞游戏线程）
 * - 收到数据后 AsyncTask 切回游戏线程，解析 JSON 触发委托
 * - 心跳通过 FTimerManager 定时入队发送队列
 */

#include "UEHperDeviceAdminSubsystem.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "IPAddress.h"
#include "Async/Async.h"
#include "TimerManager.h"
#include "Engine/World.h"
#include "HAL/PlatformMisc.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

#if UEHPER_WITH_PICO_ENTERPRISE
#include "PICO_EnterpriseFunctionLibrary.h"
#endif

// ─────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────

void UUEHperDeviceAdminSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	UE_LOG(LogTemp, Display, TEXT("[Swarm] DeviceAdminSubsystem initialized"));
}

void UUEHperDeviceAdminSubsystem::Deinitialize()
{
	DisableKeepAwake();
	StopHeartbeat();
	Super::Deinitialize();
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

void UUEHperDeviceAdminSubsystem::StartHeartbeat(const FString& InDeviceId, int32 HeartbeatIntervalMs, int32 Port, int32 InTargetPort)
{
	if (bRunning)
	{
		UE_LOG(LogTemp, Warning, TEXT("[Swarm] Already running, call StopHeartbeat first"));
		return;
	}

	DeviceId = InDeviceId;
	UDPPort = Port;
	TargetPort = InTargetPort;
	bRunning = true;

	// 启动 UDP 收发线程
	Worker = new FDeviceAdminWorker(this, UDPPort, TargetPort);
	WorkerThread = FRunnableThread::Create(Worker, TEXT("SwarmDeviceAdmin"), 0, TPri_BelowNormal);
	UE_LOG(LogTemp, Display, TEXT("[Swarm] Started UDP worker on port %d, target=%d, deviceId=%s"), UDPPort, TargetPort, *DeviceId);

	// 启动心跳定时器
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(
			HeartbeatTimerHandle,
			this,
			&UUEHperDeviceAdminSubsystem::BroadcastHeartbeat,
			HeartbeatIntervalMs / 1000.0f,
			true,
			0.5f // 首次延迟 0.5s，等 socket 绑定完成
		);
	}
}

void UUEHperDeviceAdminSubsystem::StopHeartbeat()
{
	if (!bRunning) return;
	bRunning = false;

	// 停止定时器
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(HeartbeatTimerHandle);
	}

	// 停止工作线程
	if (Worker)
	{
		Worker->Stop();
	}
	if (WorkerThread)
	{
		WorkerThread->WaitForCompletion();
		delete WorkerThread;
		WorkerThread = nullptr;
	}
	if (Worker)
	{
		delete Worker;
		Worker = nullptr;
	}

	UE_LOG(LogTemp, Display, TEXT("[Swarm] Stopped"));
}

void UUEHperDeviceAdminSubsystem::SetDeviceRole(const FString& InRole)
{
	DeviceRole = InRole;
}

void UUEHperDeviceAdminSubsystem::UpdateDeviceId(const FString& NewDeviceId)
{
	if (NewDeviceId.IsEmpty() || NewDeviceId == DeviceId)
	{
		return;
	}
	UE_LOG(LogTemp, Display, TEXT("[Swarm] DeviceId updated: %s -> %s"), *DeviceId, *NewDeviceId);
	DeviceId = NewDeviceId;
	// 心跳定时器循环使用 DeviceId 字段，下次心跳自动携带新 ID，无需重启 Worker
}

void UUEHperDeviceAdminSubsystem::SetDeviceStatus(const FString& InStatus)
{
	DeviceStatus = InStatus;
}

void UUEHperDeviceAdminSubsystem::SetGamePort(int32 InGamePort)
{
	GamePort = InGamePort;
}

void UUEHperDeviceAdminSubsystem::SetRoom(const FString& InRoom)
{
	DeviceRoom = InRoom;
}

void UUEHperDeviceAdminSubsystem::SetRoomId(int32 InRoomId)
{
	DeviceRoomId = InRoomId;
}

void UUEHperDeviceAdminSubsystem::SetGameState(const FString& InGameState)
{
	DeviceGameState = InGameState;
}

void UUEHperDeviceAdminSubsystem::BroadcastHeartbeatNow()
{
	BroadcastHeartbeat();
}

void UUEHperDeviceAdminSubsystem::SendAck(const FString& AckId, bool bOK, const FString& Message)
{
	if (Worker && bRunning)
	{
		Worker->EnqueueAck(AckId, bOK, Message);
	}
}

void UUEHperDeviceAdminSubsystem::EnableKeepAwake(bool bSetAutoSleepNever, bool bSetScreenOffNever)
{
	bKeepAwakeRequested = true;
	bKeepAwakeSetAutoSleepNever = bSetAutoSleepNever;
	bKeepAwakeSetScreenOffNever = bSetScreenOffNever;

#if !PLATFORM_ANDROID
	UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] EnableKeepAwake noop on non-Android platform"));
	return;
#elif !UEHPER_WITH_PICO_ENTERPRISE
	UE_LOG(LogTemp, Warning, TEXT("[DeviceAdmin] EnableKeepAwake skipped: PICOEnterprise plugin unavailable"));
	return;
#else
	if (bPicoTobBound)
	{
		ApplyKeepAwakeSettings();
		return;
	}

	if (bPicoTobBinding)
	{
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] EnableKeepAwake waiting for ToB service bind"));
		return;
	}

	bPicoTobBinding = true;
	FPICOBindTobServiceDelegate BindDelegate;
	BindDelegate.BindDynamic(this, &UUEHperDeviceAdminSubsystem::HandlePicoTobServiceBound);
	UPICOEnterpriseFunctionLibrary::PE_BindTobService(BindDelegate);
	UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Binding PICO ToB service for keep-awake"));
#endif
}

void UUEHperDeviceAdminSubsystem::DisableKeepAwake()
{
	bKeepAwakeRequested = false;

#if PLATFORM_ANDROID && UEHPER_WITH_PICO_ENTERPRISE
	if (bKeepAwakeApplied)
	{
		UPICOEnterpriseFunctionLibrary::PE_ReleaseWakeLock();
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Released PICO wake lock"));
	}

	if (bPicoTobBound)
	{
		RestoreKeepAwakePolicy();
		UPICOEnterpriseFunctionLibrary::PE_UnBindTobService();
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Unbound PICO ToB service"));
	}
#endif

	bKeepAwakeApplied = false;
	bPicoTobBinding = false;
	bPicoTobBound = false;
	bHasCachedSleepDelay = false;
	bHasCachedScreenOffDelay = false;
	CachedSleepDelay = -1;
	CachedScreenOffDelay = -1;
}

FString UUEHperDeviceAdminSubsystem::GetLocalIPAddress()
{
	// 获取本机局域网 IP
	bool bCanBindAll = false;
	TSharedRef<FInternetAddr> LocalAddr = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->GetLocalHostAddr(*GLog, bCanBindAll);
	return LocalAddr->ToString(false);
}

void UUEHperDeviceAdminSubsystem::ApplyKeepAwakeSettings()
{
#if PLATFORM_ANDROID && UEHPER_WITH_PICO_ENTERPRISE
	if (!bKeepAwakeRequested || !bPicoTobBound)
	{
		return;
	}

	CacheKeepAwakePolicy();

	if (bKeepAwakeSetAutoSleepNever)
	{
		const bool bSleepUpdated = UPICOEnterpriseFunctionLibrary::PE_SetSystemAutoSleepTime(ESleepDelayTimeEnum::NEVER);
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Set auto sleep to NEVER: %s"), bSleepUpdated ? TEXT("ok") : TEXT("failed"));
	}

	if (bKeepAwakeSetScreenOffNever)
	{
		FPICOSetScreenOffDelayDelegate DelayDelegate;
		DelayDelegate.BindDynamic(this, &UUEHperDeviceAdminSubsystem::HandleSetScreenOffDelayResult);
		UPICOEnterpriseFunctionLibrary::PE_SetScreenOffDelay(EScreenOffDelayTimeEnum::NEVER, DelayDelegate);
	}

	UPICOEnterpriseFunctionLibrary::PE_AcquireWakeLock();
	bKeepAwakeApplied = true;
	UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Keep-awake applied (autoSleepNever=%s, screenOffNever=%s)"),
		bKeepAwakeSetAutoSleepNever ? TEXT("true") : TEXT("false"),
		bKeepAwakeSetScreenOffNever ? TEXT("true") : TEXT("false"));
#endif
}

void UUEHperDeviceAdminSubsystem::CacheKeepAwakePolicy()
{
#if PLATFORM_ANDROID && UEHPER_WITH_PICO_ENTERPRISE
	if (bKeepAwakeSetAutoSleepNever && !bHasCachedSleepDelay)
	{
		CachedSleepDelay = static_cast<int32>(UPICOEnterpriseFunctionLibrary::PE_GetSleepDelay(0));
		bHasCachedSleepDelay = true;
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Cached sleep delay=%d"), CachedSleepDelay);
	}

	if (bKeepAwakeSetScreenOffNever && !bHasCachedScreenOffDelay)
	{
		CachedScreenOffDelay = static_cast<int32>(UPICOEnterpriseFunctionLibrary::PE_GetScreenOffDelay(0));
		bHasCachedScreenOffDelay = true;
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Cached screen-off delay=%d"), CachedScreenOffDelay);
	}
#endif
}

void UUEHperDeviceAdminSubsystem::RestoreKeepAwakePolicy()
{
#if PLATFORM_ANDROID && UEHPER_WITH_PICO_ENTERPRISE
	if (bHasCachedSleepDelay && CachedSleepDelay >= 0)
	{
		const bool bSleepRestored = UPICOEnterpriseFunctionLibrary::PE_SetSystemAutoSleepTime(static_cast<ESleepDelayTimeEnum>(CachedSleepDelay));
		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Restored auto sleep delay=%d: %s"), CachedSleepDelay, bSleepRestored ? TEXT("ok") : TEXT("failed"));
	}

	if (bHasCachedScreenOffDelay && CachedScreenOffDelay >= 0)
	{
		FPICOSetScreenOffDelayDelegate DelayDelegate;
		DelayDelegate.BindDynamic(this, &UUEHperDeviceAdminSubsystem::HandleSetScreenOffDelayResult);
		UPICOEnterpriseFunctionLibrary::PE_SetScreenOffDelay(static_cast<EScreenOffDelayTimeEnum>(CachedScreenOffDelay), DelayDelegate);
	}
#endif
}

void UUEHperDeviceAdminSubsystem::HandlePicoTobServiceBound(bool bResult)
{
	AsyncTask(ENamedThreads::GameThread, [WeakThis = TWeakObjectPtr<UUEHperDeviceAdminSubsystem>(this), bResult]()
	{
		if (!WeakThis.IsValid())
		{
			return;
		}

		UUEHperDeviceAdminSubsystem* This = WeakThis.Get();
		This->bPicoTobBinding = false;
		This->bPicoTobBound = bResult;

		if (!bResult)
		{
			UE_LOG(LogTemp, Warning, TEXT("[DeviceAdmin] Failed to bind PICO ToB service"));
			return;
		}

		UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Bound PICO ToB service"));
		if (This->bKeepAwakeRequested)
		{
			This->ApplyKeepAwakeSettings();
		}
		else
		{
			UPICOEnterpriseFunctionLibrary::PE_UnBindTobService();
			This->bPicoTobBound = false;
		}
	});
}

void UUEHperDeviceAdminSubsystem::HandleSetScreenOffDelayResult(int32 Result)
{
	UE_LOG(LogTemp, Display, TEXT("[DeviceAdmin] Set screen-off delay callback result=%d"), Result);
}

// ─────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────

void UUEHperDeviceAdminSubsystem::BroadcastHeartbeat()
{
	if (!Worker || !bRunning) return;

	const FString LocalIP = GetLocalIPAddress();

	// 构建心跳 JSON
	TSharedPtr<FJsonObject> Json = MakeShareable(new FJsonObject);
	Json->SetStringField(TEXT("deviceId"), DeviceId);
	Json->SetStringField(TEXT("ip"), LocalIP);
	Json->SetStringField(TEXT("role"), DeviceRole);
	Json->SetStringField(TEXT("status"), DeviceStatus);
	Json->SetNumberField(TEXT("listenPort"), UDPPort);
	Json->SetNumberField(TEXT("gamePort"), GamePort);
	if (!DeviceRoom.IsEmpty())
	{
		Json->SetStringField(TEXT("room"), DeviceRoom);
	}
	if (DeviceRoomId > 0)
	{
		Json->SetNumberField(TEXT("roomId"), DeviceRoomId);
	}
	if (!DeviceGameState.IsEmpty())
	{
		Json->SetStringField(TEXT("gameState"), DeviceGameState);
	}
	// 控制权归属：让所有 Swarm 通过心跳看到"该设备当前归谁管"，UI 据此显示 + 仲裁"已被占用"。
	// 无 owner 时（首次开机、设备游离）字段为空/0，任何 Swarm 都可以成为 first-wins 首次 owner。
	if (!CurrentSwarmId.IsEmpty())
	{
		Json->SetStringField(TEXT("ownerSwarm"), CurrentSwarmId);
		Json->SetNumberField(TEXT("ownerEpoch"), static_cast<double>(CurrentOwnerEpoch));
	}

	FString JsonStr;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonStr);
	FJsonSerializer::Serialize(Json.ToSharedRef(), Writer);

	Worker->EnqueueHeartbeat(JsonStr);
}

// ─────────────────────────────────────────────
// Command Handling (game thread)
// ─────────────────────────────────────────────

void UUEHperDeviceAdminSubsystem::HandleReceivedCommand(const FString& JsonStr, const FString& SenderIP)
{
	// 解析命令 JSON
	TSharedPtr<FJsonObject> Json;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonStr);
	if (!FJsonSerializer::Deserialize(Reader, Json) || !Json.IsValid())
	{
		UE_LOG(LogTemp, Warning, TEXT("[Swarm] Failed to parse command from %s: %s"), *SenderIP, *JsonStr);
		return;
	}

	// 服务发现：Swarm 回复的 swarm-hello 包，提取 Swarm IP + TCP 端口
	FString RawCmd = Json->HasField(TEXT("cmd")) ? Json->GetStringField(TEXT("cmd")) : FString();

	// 设备心跳包：有 deviceId + ip 字段且无 cmd 字段 → 广播 OnDeviceHeartbeatReceived（不作为命令处理）
	// 这是同网段其他设备的 UDP 心跳广播，用于 DeviceTopologyService 维护设备拓扑表
	if (RawCmd.IsEmpty() && Json->HasField(TEXT("deviceId")) && Json->HasField(TEXT("ip")))
	{
		const FString SenderDeviceId = Json->GetStringField(TEXT("deviceId"));
		// 忽略自己的心跳回环（同一 deviceId）
		if (SenderDeviceId != DeviceId)
		{
			OnDeviceHeartbeatReceived.Broadcast(SenderDeviceId, JsonStr);
		}
		return;
	}

	if (RawCmd == TEXT("swarm-hello"))
	{
		const int32 NewPort = Json->HasField(TEXT("tcpControlPort")) ? Json->GetIntegerField(TEXT("tcpControlPort")) : 20001;
		const bool bChanged = (LastSwarmSenderIP != SenderIP) || (DiscoveredTcpPort != NewPort);
		LastSwarmSenderIP = SenderIP;
		DiscoveredTcpPort = NewPort;
		// 仅在首次或 IP/端口变化时打日志，避免每次心跳 ack 都刷屏
		if (bChanged)
		{
			UE_LOG(LogTemp, Display, TEXT("[Swarm] Discovered: %s:%d (via UDP hello)"), *LastSwarmSenderIP, DiscoveredTcpPort);
		}
		return;
	}

	// 控制权接管：Swarm 主动下发的 swarm-takeover（操作员在 UI 点"接管"触发），
	// 含单调递增 epoch 作为仲裁依据。HandleSwarmTakeoverIfAny 内部判断 epoch > Current，
	// 通过则更新 owner 字段并广播 OnSwarmOwnerChanged，TS 端订阅后切换 TCP 目标。
	if (RawCmd == TEXT("swarm-takeover"))
	{
		const FString NewSwarmId = Json->HasField(TEXT("swarmId")) ? Json->GetStringField(TEXT("swarmId")) : FString();
		const int64 Epoch = Json->HasField(TEXT("epoch")) ? static_cast<int64>(Json->GetNumberField(TEXT("epoch"))) : 0;
		const int32 TcpPort = Json->HasField(TEXT("tcpPort")) ? Json->GetIntegerField(TEXT("tcpPort")) : 20001;
		HandleSwarmTakeoverIfAny(SenderIP, NewSwarmId, Epoch, TcpPort);
		return;
	}

	FSwarmCommand Command;
	Command.Cmd = RawCmd;
	Command.ID = Json->HasField(TEXT("id")) ? Json->GetStringField(TEXT("id")) : FString();
	Command.ServerIP = Json->HasField(TEXT("serverIp")) ? Json->GetStringField(TEXT("serverIp")) : FString();
	Command.Port = Json->HasField(TEXT("port")) ? Json->GetIntegerField(TEXT("port")) : 0;
	Command.Room = Json->HasField(TEXT("room")) ? Json->GetStringField(TEXT("room")) : FString();
	Command.RoomId = Json->HasField(TEXT("roomId")) ? Json->GetIntegerField(TEXT("roomId")) : 0;
	Command.Action = Json->HasField(TEXT("action")) ? Json->GetStringField(TEXT("action")) : FString();
	Command.SegmentIndex = Json->HasField(TEXT("segmentIndex")) ? Json->GetIntegerField(TEXT("segmentIndex")) : 0;
	Command.LevelIndex = Json->HasField(TEXT("levelIndex")) ? Json->GetIntegerField(TEXT("levelIndex")) : 0;
	if (Json->HasField(TEXT("targetDeviceId")))
	{
		Command.TargetDeviceId = Json->GetStringField(TEXT("targetDeviceId"));
	}
	else if (Json->HasField(TEXT("deviceId")))
	{
		Command.TargetDeviceId = Json->GetStringField(TEXT("deviceId"));
	}
	else if (!Command.ID.IsEmpty())
	{
		int32 LastHyphenIndex = INDEX_NONE;
		if (Command.ID.FindLastChar(TEXT('-'), LastHyphenIndex) && LastHyphenIndex > 0)
		{
			Command.TargetDeviceId = Command.ID.Left(LastHyphenIndex);
		}
	}

	if (!Command.TargetDeviceId.IsEmpty() && !DeviceId.IsEmpty() && Command.TargetDeviceId != DeviceId)
	{
		UE_LOG(LogTemp, Verbose, TEXT("[Swarm] Ignored command: cmd=%s id=%s target=%s local=%s from=%s"), *Command.Cmd, *Command.ID, *Command.TargetDeviceId, *DeviceId, *SenderIP);
		return;
	}

	UE_LOG(LogTemp, Display, TEXT("[Swarm] Received command: cmd=%s id=%s target=%s from=%s"), *Command.Cmd, *Command.ID, *Command.TargetDeviceId, *SenderIP);

	// ACK 由 TS 业务层通过 SendAck 发送，框架层不再自动 ACK
	// 这样业务层可以携带结构化执行结果（如当前环节状态）

	// 触发委托（TS 绑定入口）
	OnSwarmCommandReceived.Broadcast(Command);
}

bool UUEHperDeviceAdminSubsystem::HandleSwarmTakeoverIfAny(const FString& SenderIp, const FString& SwarmId, int64 Epoch, int32 TcpPort)
{
	// 单调仲裁：仅当 epoch 严格大于当前 owner epoch 时才切换。
	// 相等/过期一律忽略，防止迟到包/重复触发引起 owner 抖动。
	if (Epoch <= CurrentOwnerEpoch)
	{
		UE_LOG(LogTemp, Verbose, TEXT("[Swarm] takeover ignored: swarmId=%s epoch=%lld <= current=%lld"),
			*SwarmId, Epoch, CurrentOwnerEpoch);
		return false;
	}

	const FString OldSwarmId = CurrentSwarmId;
	const int64 OldEpoch = CurrentOwnerEpoch;
	CurrentSwarmId = SwarmId;
	CurrentOwnerEpoch = Epoch;
	CurrentSwarmTcpPort = TcpPort;
	// LastSwarmSenderIP 也同步更新，便于在 sticky 逻辑里直接连 owner
	LastSwarmSenderIP = SenderIp;
	DiscoveredTcpPort = TcpPort;

	UE_LOG(LogTemp, Display, TEXT("[Swarm] Takeover: '%s' -> '%s' (epoch %lld -> %lld), new owner:%s:%d"),
		*OldSwarmId, *SwarmId, OldEpoch, Epoch, *SenderIp, TcpPort);

	OnSwarmOwnerChanged.Broadcast(SwarmId, Epoch, SenderIp, TcpPort);
	return true;
}

// ─────────────────────────────────────────────
// FDeviceAdminWorker (UDP thread)
// ─────────────────────────────────────────────

UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::FDeviceAdminWorker(
	UUEHperDeviceAdminSubsystem* InOwner, int32 InPort, int32 InTargetPort)
	: Owner(InOwner), Port(InPort), TargetPort(InTargetPort)
{
	RecvBuffer.SetNumUninitialized(65507);
	bShouldRun = true;
}

UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::~FDeviceAdminWorker()
{
	ReleaseSocket();
}

uint32 UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::Run()
{
	while (bShouldRun)
	{
		if (!Socket)
		{
			if (!TryBind())
			{
				FPlatformProcess::Sleep(1.0f);
				continue;
			}
		}

		ProcessReceive();
		ProcessSend();
		FPlatformProcess::Sleep(0.001f);
	}

	ReleaseSocket();
	return 0;
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::Stop()
{
	bShouldRun = false;
}

bool UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::TryBind()
{
	ISocketSubsystem* SocketSub = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);

	// 尝试绑定端口：先用配置端口，失败则尝试 TargetPort（Swarm 端口）
	// 生产环境：Port=19998 会被 Swarm 占用，自动回退到 19999
	// PICO 设备：Port=19998 未被占用，直接使用
	TArray<int32> PortsToTry;
	PortsToTry.Add(Port);
	if (Port != TargetPort)
	{
		PortsToTry.Add(TargetPort);
	}

	for (int32 TryPort : PortsToTry)
	{
		FSocket* TestSocket = SocketSub->CreateSocket(NAME_DGram, TEXT("SwarmDeviceAdmin"), false);
		if (!TestSocket)
		{
			UE_LOG(LogTemp, Error, TEXT("[Swarm] Failed to create UDP socket"));
			return false;
		}

		TSharedRef<FInternetAddr> Addr = SocketSub->CreateInternetAddr();
		Addr->SetAnyAddress();
		Addr->SetPort(TryPort);

		TestSocket->SetReuseAddr(true);
		TestSocket->SetNonBlocking(true);

		if (TestSocket->Bind(*Addr))
		{
			TestSocket->SetBroadcast(true);
			Socket = TestSocket;
			Port = TryPort; // 更新实际使用的端口
			// 同步到 Subsystem，让心跳携带正确的 listenPort
			if (Owner)
			{
				Owner->UDPPort = TryPort;
			}
			UE_LOG(LogTemp, Display, TEXT("[Swarm] UDP bound to port %d (target=%d)"), Port, TargetPort);
			return true;
		}

		UE_LOG(LogTemp, Warning, TEXT("[Swarm] Port %d occupied, trying next..."), TryPort);
		TestSocket->Close();
		SocketSub->DestroySocket(TestSocket);
	}

	UE_LOG(LogTemp, Error, TEXT("[Swarm] Failed to bind any UDP port"));
	return false;
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::ProcessReceive()
{
	if (!Socket) return;

	uint32 PendingSize = 0;
	ISocketSubsystem* SocketSub = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	TSharedRef<FInternetAddr> SenderAddr = SocketSub->CreateInternetAddr();

	while (Socket->HasPendingData(PendingSize))
	{
		int32 BytesRead = 0;
		if (Socket->RecvFrom(RecvBuffer.GetData(), RecvBuffer.Num(), BytesRead, *SenderAddr))
		{
			if (BytesRead > 0)
			{
				FString SenderIP = SenderAddr->ToString(false);
				// 先对 BytesRead 个 UTF-8 字节做 null 结尾拷贝，再整体解码。
				// 不可用 FString(BytesRead, UTF8_TO_TCHAR(...))：BytesRead 是字节数而非字符数，
				// 中文等多字节会让 FString 构造越界读取解码缓冲区，产生乱码。
				TArray<uint8> Utf8Bytes;
				Utf8Bytes.Append(RecvBuffer.GetData(), BytesRead);
				Utf8Bytes.Add(0);
				FString JsonStr(UTF8_TO_TCHAR(reinterpret_cast<const char*>(Utf8Bytes.GetData())));
				// 截断 JSON 闭合 } 后的垃圾字节（UDP 包可能附带 padding/重传残留）
				int32 LastBrace = INDEX_NONE;
				if (JsonStr.FindLastChar(TEXT('}'), LastBrace))
				{
					JsonStr.LeftInline(LastBrace + 1);
				}

				// 切回游戏线程处理
				AsyncTask(ENamedThreads::GameThread,
					[OwnerPtr = TWeakObjectPtr<UUEHperDeviceAdminSubsystem>(Owner), JsonStr, SenderIP]()
					{
						if (OwnerPtr.IsValid())
						{
							OwnerPtr->HandleReceivedCommand(JsonStr, SenderIP);
						}
					});
			}
		}
	}
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::ProcessSend()
{
	if (!Socket) return;

	FOutPacket Packet;
	while (SendQueue.Dequeue(Packet))
	{
		// 发送到广播地址（心跳）或直接发回发送者（ack 都发到 Swarm 端口）
		ISocketSubsystem* SocketSub = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
		TSharedRef<FInternetAddr> TargetAddr = SocketSub->CreateInternetAddr();
		bool bIsValid = false;

		// 广播到 255.255.255.255:TargetPort（Swarm 服务端口）
		TargetAddr->SetBroadcastAddress();
		TargetAddr->SetPort(TargetPort);

		int32 Sent = 0;
		Socket->SendTo(Packet.Data.GetData(), Packet.Data.Num(), Sent, *TargetAddr);
	}
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::EnqueueHeartbeat(const FString& JsonPayload)
{
	TArray<uint8> Data;
	FTCHARToUTF8 Converter(*JsonPayload);
	Data.Append((uint8*)Converter.Get(), Converter.Length());
	SendQueue.Enqueue(FOutPacket{MoveTemp(Data)});
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::EnqueueAck(const FString& AckId, bool bOK, const FString& Message)
{
	TSharedPtr<FJsonObject> Json = MakeShareable(new FJsonObject);
	Json->SetStringField(TEXT("ack"), AckId);
	Json->SetBoolField(TEXT("ok"), bOK);
	if (!Message.IsEmpty())
	{
		Json->SetStringField(TEXT("message"), Message);
	}

	FString JsonStr;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&JsonStr);
	FJsonSerializer::Serialize(Json.ToSharedRef(), Writer);

	TArray<uint8> Data;
	FTCHARToUTF8 Converter(*JsonStr);
	Data.Append((uint8*)Converter.Get(), Converter.Length());
	SendQueue.Enqueue(FOutPacket{MoveTemp(Data)});
}

void UUEHperDeviceAdminSubsystem::FDeviceAdminWorker::ReleaseSocket()
{
	if (Socket)
	{
		Socket->Close();
		ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket);
		Socket = nullptr;
	}
}
