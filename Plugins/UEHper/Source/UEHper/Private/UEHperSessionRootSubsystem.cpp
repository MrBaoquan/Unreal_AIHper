/**
 * Session Root 子系统实现 (UEHper 框架层, P2-A 新增)
 *
 * 跨 World 持久的会话状态 C++ 容器实现。
 * 状态变更时广播 OnSessionStateChanged 委托，TS 侧通过 toManualReleaseDelegate 绑定。
 *
 * 框架下沉：此模块属于 UEHper 框架能力，不依赖项目业务层。
 */
#include "UEHperSessionRootSubsystem.h"
#include "UEHperJsonSaveGame.h"
#include "Kismet/GameplayStatics.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"

void UUEHperSessionRootSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);
    // P4-D: 进程启动时从磁盘恢复会话状态
    LoadFromDisk();
    UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] Initialized (GameInstance-scoped, cross-World persistent)"));
}

void UUEHperSessionRootSubsystem::Deinitialize()
{
    // P4-D: 进程退出时保存会话状态到磁盘
    SaveToDisk();
    UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] Deinitialized"));
    Super::Deinitialize();
}

void UUEHperSessionRootSubsystem::SetRole(EUEHperDeviceRole InRole)
{
    if (Role == InRole)
    {
        return;
    }
    EUEHperDeviceRole PrevRole = Role;
    EUEHperSessionPhase PrevPhase = SessionPhase;
    Role = InRole;
    BroadcastIfChanged(PrevRole, PrevPhase);
}

void UUEHperSessionRootSubsystem::SetRoomId(const FString& InRoomId)
{
    RoomId = InRoomId;
}

void UUEHperSessionRootSubsystem::SetSessionId(const FString& InSessionId)
{
    SessionId = InSessionId;
}

void UUEHperSessionRootSubsystem::SetWorldId(const FString& InWorldId)
{
    WorldId = InWorldId;
}

void UUEHperSessionRootSubsystem::SetSessionPhase(EUEHperSessionPhase InPhase)
{
    if (SessionPhase == InPhase)
    {
        return;
    }
    EUEHperDeviceRole PrevRole = Role;
    EUEHperSessionPhase PrevPhase = SessionPhase;
    SessionPhase = InPhase;
    BroadcastIfChanged(PrevRole, PrevPhase);
}

void UUEHperSessionRootSubsystem::SetTopologyPhase(EUEHperTopologyPhase InPhase)
{
    TopologyPhase = InPhase;
}

void UUEHperSessionRootSubsystem::SetAuthorityDeviceId(const FString& InDeviceId)
{
    AuthorityDeviceId = InDeviceId;
}

void UUEHperSessionRootSubsystem::SetPlayerCount(int32 InCount)
{
    PlayerCount = InCount;
}

void UUEHperSessionRootSubsystem::SetLastCommandId(const FString& InCommandId)
{
    LastCommandId = InCommandId;
}

void UUEHperSessionRootSubsystem::ResetSession()
{
    EUEHperDeviceRole PrevRole = Role;
    EUEHperSessionPhase PrevPhase = SessionPhase;

    Role = EUEHperDeviceRole::Standalone;
    RoomId.Reset();
    SessionId.Reset();
    WorldId.Reset();
    SessionPhase = EUEHperSessionPhase::Idle;
    TopologyPhase = EUEHperTopologyPhase::Idle;
    AuthorityDeviceId.Reset();
    PlayerCount = 0;
    LastCommandId.Reset();

    BroadcastIfChanged(PrevRole, PrevPhase);
    UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] Session reset to initial state"));
}

void UUEHperSessionRootSubsystem::BroadcastIfChanged(EUEHperDeviceRole PrevRole, EUEHperSessionPhase PrevPhase)
{
    if (PrevRole != Role || PrevPhase != SessionPhase)
    {
        OnSessionStateChanged.Broadcast(Role, SessionPhase);
        UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] State changed: Role=%d, SessionPhase=%d"),
            (uint8)Role, (uint8)SessionPhase);
        // P4-D: 关键状态变化时自动保存到磁盘
        SaveToDisk();
    }
}

// ── P4-D: SaveGame 持久化 ──

static const FString SessionSaveSlot = TEXT("uehper-session");

bool UUEHperSessionRootSubsystem::SaveToDisk()
{
    UUEHperJsonSaveGame* SaveGame = NewObject<UUEHperJsonSaveGame>();

    // 序列化会话状态为 JSON
    TSharedPtr<FJsonObject> JsonObj = MakeShareable(new FJsonObject);
    JsonObj->SetNumberField(TEXT("role"), static_cast<int32>(Role));
    JsonObj->SetStringField(TEXT("roomId"), RoomId);
    JsonObj->SetStringField(TEXT("sessionId"), SessionId);
    JsonObj->SetStringField(TEXT("worldId"), WorldId);
    JsonObj->SetNumberField(TEXT("sessionPhase"), static_cast<int32>(SessionPhase));
    JsonObj->SetNumberField(TEXT("topologyPhase"), static_cast<int32>(TopologyPhase));
    JsonObj->SetStringField(TEXT("authorityDeviceId"), AuthorityDeviceId);
    JsonObj->SetNumberField(TEXT("playerCount"), PlayerCount);
    JsonObj->SetStringField(TEXT("lastCommandId"), LastCommandId);

    FString JsonStr;
    TSharedRef<TJsonWriter<>> JsonWriter = TJsonWriterFactory<>::Create(&JsonStr);
    FJsonSerializer::Serialize(JsonObj.ToSharedRef(), JsonWriter);

    SaveGame->PayloadJson = JsonStr;

    bool bSuccess = UGameplayStatics::SaveGameToSlot(SaveGame, SessionSaveSlot, 0);
    UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] SaveToDisk: %s (role=%d, room=%s)"),
        bSuccess ? TEXT("OK") : TEXT("FAILED"), (uint8)Role, *RoomId);
    return bSuccess;
}

bool UUEHperSessionRootSubsystem::LoadFromDisk()
{
    if (!UGameplayStatics::DoesSaveGameExist(SessionSaveSlot, 0))
    {
        UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] LoadFromDisk: no save game found, using defaults"));
        return false;
    }

    UUEHperJsonSaveGame* SaveGame = Cast<UUEHperJsonSaveGame>(
        UGameplayStatics::LoadGameFromSlot(SessionSaveSlot, 0));
    if (!SaveGame)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperSessionRoot] LoadFromDisk: failed to load save game"));
        return false;
    }

    TSharedPtr<FJsonObject> JsonObj;
    TSharedRef<TJsonReader<>> JsonReader = TJsonReaderFactory<>::Create(SaveGame->PayloadJson);
    if (!FJsonSerializer::Deserialize(JsonReader, JsonObj) || !JsonObj.IsValid())
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperSessionRoot] LoadFromDisk: JSON parse failed"));
        return false;
    }

    EUEHperDeviceRole PrevRole = Role;
    EUEHperSessionPhase PrevPhase = SessionPhase;

    int32 RoleInt = 0;
    JsonObj->TryGetNumberField(TEXT("role"), RoleInt);
    Role = static_cast<EUEHperDeviceRole>(RoleInt);

    JsonObj->TryGetStringField(TEXT("roomId"), RoomId);
    JsonObj->TryGetStringField(TEXT("sessionId"), SessionId);
    JsonObj->TryGetStringField(TEXT("worldId"), WorldId);

    int32 PhaseInt = 0;
    JsonObj->TryGetNumberField(TEXT("sessionPhase"), PhaseInt);
    SessionPhase = static_cast<EUEHperSessionPhase>(PhaseInt);

    int32 TopologyInt = 0;
    JsonObj->TryGetNumberField(TEXT("topologyPhase"), TopologyInt);
    TopologyPhase = static_cast<EUEHperTopologyPhase>(TopologyInt);

    JsonObj->TryGetStringField(TEXT("authorityDeviceId"), AuthorityDeviceId);

    int32 Count = 0;
    JsonObj->TryGetNumberField(TEXT("playerCount"), Count);
    PlayerCount = Count;

    JsonObj->TryGetStringField(TEXT("lastCommandId"), LastCommandId);

    UE_LOG(LogTemp, Log, TEXT("[UEHperSessionRoot] LoadFromDisk: OK (role=%d, room=%s, sessionPhase=%d)"),
        (uint8)Role, *RoomId, (uint8)SessionPhase);

    BroadcastIfChanged(PrevRole, PrevPhase);
    return true;
}
