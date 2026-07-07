/**
 * UEHper TCP 客户端实现 (P3-A 新增)
 *
 * Swarm TCP 控制通道客户端实现：后台线程连接 Swarm，JSON Lines 双向收发。
 *
 * 框架下沉：此模块属于 UEHper 框架能力，不依赖项目业务层。
 */
#include "UEHperTcpClient.h"
#include "UEHperSha256.h"
#include "Sockets.h"
#include "SocketSubsystem.h"
#include "IPAddress.h"
#include "Async/Async.h"
#include "HAL/PlatformTime.h"
#include "Misc/DateTime.h"
#include "Interfaces/IPv4/IPv4Address.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

UUEHperTcpClient::UUEHperTcpClient()
{
    RecvBuffer.SetNumUninitialized(8192);
}

void UUEHperTcpClient::Start(const FString& Host, int32 Port, const FString& DeviceId)
{
    if (bShouldRun.load())
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Already running"));
        return;
    }

    RemoteHost = Host;
    RemotePort = Port;
    LocalDeviceId = DeviceId;
    bShouldRun = true;
    ReconnectAttempt = 0;
    NextReconnectTime = FPlatformTime::Seconds();

    Thread = FRunnableThread::Create(this, TEXT("UEHperTcpClient"), 0, TPri_Normal);
    UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] Starting TCP client, target=%s:%d, deviceId=%s"), *Host, Port, *DeviceId);
}

void UUEHperTcpClient::ShutdownTcp()
{
    bShouldRun = false;
    ReleaseSocket();

    if (Thread)
    {
        Thread->WaitForCompletion();
        delete Thread;
        Thread = nullptr;
    }
    bConnected = false;
    UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] Stopped"));
}

bool UUEHperTcpClient::SendEnvelope(const FString& JsonLine)
{
    if (!bConnected.load() || !Socket)
    {
        return false;
    }

    FScopeLock Lock(&SendQueueLock);
    SendQueue.Add(JsonLine);
    return true;
}

uint32 UUEHperTcpClient::Run()
{
    RunLoop();
    return 0;
}

void UUEHperTcpClient::Stop()
{
    bShouldRun = false;
}

void UUEHperTcpClient::RunLoop()
{
    while (bShouldRun)
    {
        if (!bConnected.load())
        {
            // 等待重连退避
            const double Now = FPlatformTime::Seconds();
            if (Now < NextReconnectTime)
            {
                FPlatformProcess::Sleep(0.1f);
                continue;
            }

            if (TryConnect())
            {
                bConnected = true;
                ReconnectAttempt = 0;
                LastPingTime = FPlatformTime::Seconds();
                LastPongTime = LastPingTime;
                NotifyConnectionState(true, TEXT("connected"));
                SendRegister();
            }
            else
            {
                // 指数退避：1s, 2s, 4s, 8s, ... 上限 30s
                ReconnectAttempt++;
                int32 Backoff = 1 << FMath::Min(ReconnectAttempt, 5);
                Backoff = FMath::Min(Backoff, MaxReconnectBackoffSec);
                NextReconnectTime = FPlatformTime::Seconds() + Backoff;
                UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Connect failed, retry in %ds (attempt %d)"), Backoff, ReconnectAttempt);
                continue;
            }
        }

        ProcessReceive();
        ProcessSend();
        ProcessPing();

        // 检测 pong 超时
        const double Now = FPlatformTime::Seconds();
        if (Now - LastPongTime > PongTimeoutSec)
        {
            UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Pong timeout (%.1fs), disconnecting"), Now - LastPongTime);
            ReleaseSocket();
            bConnected = false;
            NotifyConnectionState(false, TEXT("pong-timeout"));
            NextReconnectTime = Now + 1.0;
        }

        FPlatformProcess::Sleep(0.01f);
    }

    ReleaseSocket();
}

bool UUEHperTcpClient::TryConnect()
{
    ISocketSubsystem* SocketSub = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
    if (!SocketSub)
    {
        return false;
    }

    FIPv4Address IPv4Addr;
    if (!FIPv4Address::Parse(RemoteHost, IPv4Addr))
    {
        UE_LOG(LogTemp, Error, TEXT("[UEHperTcp] Invalid host: %s"), *RemoteHost);
        return false;
    }

    TSharedRef<FInternetAddr> Addr = SocketSub->CreateInternetAddr();
    Addr->SetIp(IPv4Addr.Value);
    Addr->SetPort(RemotePort);

    FSocket* NewSocket = SocketSub->CreateSocket(NAME_Stream, TEXT("UEHperTcpClient"), false);
    if (!NewSocket)
    {
        UE_LOG(LogTemp, Error, TEXT("[UEHperTcp] Failed to create TCP socket"));
        return false;
    }

    NewSocket->SetNonBlocking(true);

    if (!NewSocket->Connect(*Addr))
    {
        // 非阻塞 Connect 可能返回 EWOULDBLOCK，需要检查连接状态
        int32 Err = SocketSub->GetLastErrorCode();
        if (Err != SE_EWOULDBLOCK && Err != SE_EINPROGRESS)
        {
            UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Connect failed, error=%d"), Err);
            NewSocket->Close();
            SocketSub->DestroySocket(NewSocket);
            return false;
        }
    }

    // 等待连接建立（非阻塞模式下需要 poll）
    FPlatformProcess::Sleep(0.1f);
    int32 PendingDataSize = 0;
    if (NewSocket->GetConnectionState() != SCS_Connected)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Connect not established, state=%d"), (int32)NewSocket->GetConnectionState());
        NewSocket->Close();
        SocketSub->DestroySocket(NewSocket);
        return false;
    }

    Socket = NewSocket;
    UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] Connected to %s:%d"), *RemoteHost, RemotePort);
    return true;
}

void UUEHperTcpClient::ProcessReceive()
{
    if (!Socket)
    {
        return;
    }

    int32 BytesRead = 0;
    while (Socket->Recv(RecvBuffer.GetData(), RecvBuffer.Num(), BytesRead))
    {
        if (BytesRead <= 0)
        {
            break;
        }

        // 拼接到行缓冲区，按 \n 分割
        for (int32 i = 0; i < BytesRead; i++)
        {
            uint8 Ch = RecvBuffer[i];
            if (Ch == '\n')
            {
                if (LineBytes.Num() > 0)
                {
                    // 整行 UTF-8 字节一次性解码，避免逐字节 Latin-1 误解码导致中文乱码。
                    LineBytes.Add(0); // null 结尾，供 UTF8_TO_TCHAR 使用
                    const FString LineCopy = FString(UTF8_TO_TCHAR(reinterpret_cast<const char*>(LineBytes.GetData())));
                    LineBytes.Reset();

                    // 处理 ping/pong（保活）
                    if (LineCopy == TEXT("pong"))
                    {
                        LastPongTime = FPlatformTime::Seconds();
                        continue;
                    }
                    if (LineCopy == TEXT("ping"))
                    {
                        // Swarm 端 pingLoop 主动 ping → UE 必须回 pong，否则 60s 后被 Swarm 断开
                        if (Socket)
                        {
                            const FString PongLine = TEXT("pong\n");
                            FTCHARToUTF8 Utf8(*PongLine);
                            int32 BytesSent = 0;
                            Socket->Send(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length(), BytesSent);
                        }
                        // 收到对端心跳也证明链路活，刷新 LastPongTime
                        LastPongTime = FPlatformTime::Seconds();
                        continue;
                    }

                    // P4-F: 如果配置了 HMAC 密钥，验签 SignedEnvelope
                    // 协议（P4-F 改造）：SignedEnvelope 含 payload 字符串字段（Envelope JSON），
                    // 避免双端 JSON 序列化字节级一致性问题。UE 端直接读取 payload 字符串验签。
                    FString PayloadToDispatch = LineCopy;
                    if (!HMACSecret.IsEmpty())
                    {
                        // 解析外层包络提取 payload/nonce/timestamp/signature
                        TSharedPtr<FJsonObject> JsonObj;
                        TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(LineCopy);
                        if (FJsonSerializer::Deserialize(Reader, JsonObj) && JsonObj.IsValid())
                        {
                            FString Payload, Nonce, Signature;
                            double Timestamp = 0;
                            const bool bHasPayload = JsonObj->TryGetStringField(TEXT("payload"), Payload);
                            const bool bHasNonce = JsonObj->TryGetStringField(TEXT("nonce"), Nonce);
                            const bool bHasTs = JsonObj->TryGetNumberField(TEXT("timestamp"), Timestamp);
                            const bool bHasSig = JsonObj->TryGetStringField(TEXT("signature"), Signature);

                            if (bHasPayload && bHasNonce && bHasTs && bHasSig)
                            {
                                if (!VerifyHMAC(Nonce, static_cast<int64>(Timestamp), Payload, Signature))
                                {
                                    UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] HMAC verify failed, dropping message"));
                                    continue;
                                }
                                // 验签通过，分发原始 Envelope payload（字符串原样）
                                PayloadToDispatch = Payload;
                            }
                            // 无签名字段时直接分发（兼容未签名消息）
                        }
                    }

                    // AsyncTask 切回游戏线程触发委托
                    AsyncTask(ENamedThreads::GameThread, [this, PayloadToDispatch]()
                    {
                        // 优先在框架层拦截 register-ack 解出 Swarm 分配的 deviceId
                        HandleRegisterAckIfAny(PayloadToDispatch);
                        OnEnvelopeReceived.Broadcast(PayloadToDispatch);
                    });
                }
            }
            else if (Ch != '\r')
            {
                LineBytes.Add(Ch);
            }
        }
    }
}

void UUEHperTcpClient::ProcessSend()
{
    if (!Socket || !bConnected.load())
    {
        return;
    }

    TArray<FString> Pending;
    {
        FScopeLock Lock(&SendQueueLock);
        Pending = MoveTemp(SendQueue);
        SendQueue.Reset();
    }

    for (const FString& Line : Pending)
    {
        FString LineWithNewline = Line + TEXT("\n");
        FTCHARToUTF8 Utf8(*LineWithNewline);
        int32 BytesSent = 0;
        if (!Socket->Send(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length(), BytesSent))
        {
            UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] Send failed, disconnecting"));
            ReleaseSocket();
            bConnected = false;
            NotifyConnectionState(false, TEXT("send-failed"));
            NextReconnectTime = FPlatformTime::Seconds() + 1.0;
            return;
        }
    }
}

void UUEHperTcpClient::ProcessPing()
{
    const double Now = FPlatformTime::Seconds();
    if (Now - LastPingTime < PingIntervalSec)
    {
        return;
    }

    if (!bConnected.load() || !Socket)
    {
        return;
    }

    // 发送 ping
    FString PingLine = TEXT("ping\n");
    FTCHARToUTF8 Utf8(*PingLine);
    int32 BytesSent = 0;
    if (Socket->Send(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length(), BytesSent))
    {
        LastPingTime = Now;
    }
}

void UUEHperTcpClient::ReleaseSocket()
{
    if (Socket)
    {
        Socket->Close();
        ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)->DestroySocket(Socket);
        Socket = nullptr;
    }
    LineBytes.Reset();
}

void UUEHperTcpClient::NotifyConnectionState(bool bNewConnected, const FString& Reason)
{
    AsyncTask(ENamedThreads::GameThread, [this, bNewConnected, Reason]()
    {
        OnConnectionStateChanged.Broadcast(bNewConnected, Reason);
    });
}

void UUEHperTcpClient::SendRegister()
{
    // 发送 register 消息（roadmap Section 8.3 第 3 步）
    // 格式：{"type":"command","name":"register","deviceId":"..."}（deviceId 视为 hint，Swarm 可能重分配）
    FString RegisterJson = FString::Printf(TEXT("{\"type\":\"command\",\"name\":\"register\",\"deviceId\":\"%s\"}"), *LocalDeviceId);
    SendEnvelope(RegisterJson);
    UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] Register sent, deviceId(hint)=%s"), *LocalDeviceId);
}

void UUEHperTcpClient::HandleRegisterAckIfAny(const FString& JsonLine)
{
    // 快速预筛选：register-ack 字符串必然存在
    if (JsonLine.Find(TEXT("register-ack"), ESearchCase::CaseSensitive) == INDEX_NONE)
    {
        return;
    }
    TSharedPtr<FJsonObject> JsonObj;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonLine);
    if (!FJsonSerializer::Deserialize(Reader, JsonObj) || !JsonObj.IsValid())
    {
        return;
    }
    FString Name;
    if (!JsonObj->TryGetStringField(TEXT("name"), Name) || Name != TEXT("register-ack"))
    {
        return;
    }
    // 优先从 params.assignedDeviceId 读取（明确语义），缺失则用顶层 deviceId 兜底
    FString Assigned;
    const TSharedPtr<FJsonObject>* ParamsObj = nullptr;
    if (JsonObj->TryGetObjectField(TEXT("params"), ParamsObj) && ParamsObj && (*ParamsObj).IsValid())
    {
        (*ParamsObj)->TryGetStringField(TEXT("assignedDeviceId"), Assigned);
    }
    if (Assigned.IsEmpty())
    {
        JsonObj->TryGetStringField(TEXT("deviceId"), Assigned);
    }
    if (Assigned.IsEmpty())
    {
        return;
    }
    const FString Requested = LocalDeviceId;
    AssignedDeviceId = Assigned;
    if (Assigned != Requested)
    {
        UE_LOG(LogTemp, Display, TEXT("[UEHperTcp] DeviceId reassigned by Swarm: %s -> %s (hint conflict)"), *Requested, *Assigned);
    }
    else
    {
        UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] DeviceId confirmed: %s"), *Assigned);
    }
    OnDeviceIdAssigned.Broadcast(Requested, Assigned);
}

// ── P4-F: HMAC-SHA256 签名校验 ──

void UUEHperTcpClient::SetHMACSecret(const FString& InSecret)
{
    HMACSecret = InSecret;
    UE_LOG(LogTemp, Log, TEXT("[UEHperTcp] HMAC secret set (length=%d)"), InSecret.Len());
}

FString UUEHperTcpClient::ComputeHMAC(const FString& Nonce, int64 Timestamp, const FString& PayloadJson)
{
    // P4-F: 使用自实现的 HMAC-SHA256（UEHperCrypto）
    FTCHARToUTF8 SecretUtf8(*HMACSecret);
    FTCHARToUTF8 NonceUtf8(*Nonce);
    const FString TimestampStr = FString::Printf(TEXT("%lld"), Timestamp);
    FTCHARToUTF8 TimestampUtf8(*TimestampStr);
    FTCHARToUTF8 PayloadUtf8(*PayloadJson);

    // 拼接消息：nonce + timestamp + payload
    TArray<uint8> Message;
    Message.Append(reinterpret_cast<const uint8*>(NonceUtf8.Get()), NonceUtf8.Length());
    Message.Append(reinterpret_cast<const uint8*>(TimestampUtf8.Get()), TimestampUtf8.Length());
    Message.Append(reinterpret_cast<const uint8*>(PayloadUtf8.Get()), PayloadUtf8.Length());

    // HMAC-SHA256
    uint8 HmacOut[UEHperCrypto::SHA256_DIGEST_SIZE];
    UEHperCrypto::HmacSha256(
        reinterpret_cast<const uint8*>(SecretUtf8.Get()), SecretUtf8.Length(),
        Message.GetData(), Message.Num(),
        HmacOut);

    return UEHperCrypto::BytesToHex(HmacOut, UEHperCrypto::SHA256_DIGEST_SIZE);
}

bool UUEHperTcpClient::VerifyHMAC(const FString& Nonce, int64 Timestamp, const FString& PayloadJson, const FString& Signature)
{
    if (HMACSecret.IsEmpty())
    {
        return true; // 无密钥时跳过校验（开发模式）
    }

    // timestamp 窗口校验
    const int64 Now = FDateTime::UtcNow().ToUnixTimestamp() * 1000 + (FDateTime::UtcNow().GetMillisecond());
    const int64 Diff = FMath::Abs(Now - Timestamp);
    if (Diff > HMACTimestampWindowMs)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] HMAC verify failed: timestamp expired (diff=%lldms)"), Diff);
        return false;
    }

    // nonce 去重
    if (NonceCache.Contains(Nonce))
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] HMAC verify failed: nonce replay (%s)"), *Nonce);
        return false;
    }
    if (NonceCache.Num() >= MaxNonceCacheSize)
    {
        NonceCache.Reset(); // 简单清空（生产可改为 LRU）
    }
    NonceCache.Add(Nonce);

    // 签名校验
    const FString Expected = ComputeHMAC(Nonce, Timestamp, PayloadJson);
    if (!Expected.Equals(Signature, ESearchCase::IgnoreCase))
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperTcp] HMAC verify failed: signature mismatch (expected=%s, got=%s)"),
            *Expected, *Signature);
        return false;
    }

    return true;
}

