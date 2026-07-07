/**
 * Session Root 子系统 (UEHper 框架层, P2-A 新增)
 *
 * 跨 World 持久的会话状态 C++ 容器，挂在 GameInstance 级别。
 * 承载 Swarm 房间控制相关的会话状态：role/roomId/sessionId/authority/topologyPhase。
 * World 重建时不销毁，保证 Swarm 控制面跨 World 连续。
 *
 * 设计原则（roadmap Section 0.2）：
 * - Session 与 World 解耦：GameInstanceSubsystem 天然跨 World 持久。
 * - 框架底座零第三方依赖：不依赖 ANDLBE 或任何项目特定插件。
 * - 高频路径下沉 C++：状态读写由 C++ UObject 承载，TS 层通过 BlueprintCallable 访问。
 *
 * 与 TS 层 SessionStateService 的关系：
 * - TS DefaultSessionStateService 是纯内存实现，P2-A 阶段改为委托 C++ UObject。
 * - C++ UObject 持久化关键状态，TS 层只做编排和事件分发。
 *
 * 框架下沉：此模块属于 UEHper 框架能力，不依赖项目业务层。
 */
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "UEHperSessionRootSubsystem.generated.h"

/** 设备角色枚举（与 TS DeviceRole 对齐） */
UENUM(BlueprintType)
enum class EUEHperDeviceRole : uint8
{
    Idle UMETA(DisplayName = "空闲"),
    Server UMETA(DisplayName = "服务端"),
    Client UMETA(DisplayName = "客户端"),
    Standalone UMETA(DisplayName = "独立运行")
};

/** 会话阶段枚举（与 TS SessionPhase 对齐） */
UENUM(BlueprintType)
enum class EUEHperSessionPhase : uint8
{
    Idle UMETA(DisplayName = "空闲"),
    Lobby UMETA(DisplayName = "大厅"),
    InMatch UMETA(DisplayName = "比赛中"),
    Settled UMETA(DisplayName = "已结算"),
    Migrating UMETA(DisplayName = "迁移中")
};

/** 拓扑阶段枚举（与 TS TopologyPhase 对齐） */
UENUM(BlueprintType)
enum class EUEHperTopologyPhase : uint8
{
    Idle UMETA(DisplayName = "空闲"),
    StartingServer UMETA(DisplayName = "启动服务端"),
    ServerReady UMETA(DisplayName = "服务端就绪"),
    ConnectingClient UMETA(DisplayName = "客户端连接中"),
    ClientConnected UMETA(DisplayName = "客户端已连接"),
    Ready UMETA(DisplayName = "就绪"),
    Failed UMETA(DisplayName = "失败")
};

/** 会话状态变更委托（TS 通过 toManualReleaseDelegate 绑定） */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnSessionStateChanged, EUEHperDeviceRole, Role, EUEHperSessionPhase, SessionPhase);

/**
 * Session Root 子系统
 *
 * 通过 GetSubsystem<UUEHperSessionRootSubsystem>() 获取。
 * TS 侧通过 BlueprintCallable API 读写会话状态，并通过 OnSessionStateChanged 委托接收变更通知。
 *
 * 持久化：状态存储在 UObject 字段，GameInstance 生命周期内跨 World 持久。
 * 线程安全：所有 API 在游戏线程调用（Subsystem 标准约定）。
 */
UCLASS()
class UEHPER_API UUEHperSessionRootSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    /** 会话状态变更委托（TS 绑定入口） */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|Session")
    FOnSessionStateChanged OnSessionStateChanged;

    // ── UGameInstanceSubsystem ──
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    // ── 只读查询 API（BlueprintPure）──

    /** 获取当前设备角色 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    EUEHperDeviceRole GetRole() const { return Role; }

    /** 获取房间 ID */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    FString GetRoomId() const { return RoomId; }

    /** 获取会话 ID */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    FString GetSessionId() const { return SessionId; }

    /** 获取当前 World ID */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    FString GetWorldId() const { return WorldId; }

    /** 获取会话阶段 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    EUEHperSessionPhase GetSessionPhase() const { return SessionPhase; }

    /** 获取拓扑阶段 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    EUEHperTopologyPhase GetTopologyPhase() const { return TopologyPhase; }

    /** 获取权威设备 ID */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    FString GetAuthorityDeviceId() const { return AuthorityDeviceId; }

    /** 获取玩家数量 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    int32 GetPlayerCount() const { return PlayerCount; }

    /** 是否为权威端（server） */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    bool IsAuthority() const { return Role == EUEHperDeviceRole::Server; }

    /** 获取最后命令 ID */
    UFUNCTION(BlueprintPure, Category = "UEHper|Session")
    FString GetLastCommandId() const { return LastCommandId; }

    // ── 写入 API（BlueprintCallable）──

    /** 设置设备角色 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetRole(EUEHperDeviceRole InRole);

    /** 设置房间 ID */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetRoomId(const FString& InRoomId);

    /** 设置会话 ID */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetSessionId(const FString& InSessionId);

    /** 设置当前 World ID */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetWorldId(const FString& InWorldId);

    /** 设置会话阶段 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetSessionPhase(EUEHperSessionPhase InPhase);

    /** 设置拓扑阶段 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetTopologyPhase(EUEHperTopologyPhase InPhase);

    /** 设置权威设备 ID */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetAuthorityDeviceId(const FString& InDeviceId);

    /** 设置玩家数量 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetPlayerCount(int32 InCount);

    /** 设置最后命令 ID */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void SetLastCommandId(const FString& InCommandId);

    /** 重置所有会话状态到初始值（kick/退出房间时调用） */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    void ResetSession();

    // ── P4-D: SaveGame 持久化（进程重启可恢复）──

    /** 保存会话状态到 SaveGame（磁盘持久化） */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    bool SaveToDisk();

    /** 从 SaveGame 加载会话状态（进程启动时调用） */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Session")
    bool LoadFromDisk();

private:
    // ── 会话状态字段（跨 World 持久，GameInstance 生命周期）──

    UPROPERTY(Transient)
    EUEHperDeviceRole Role = EUEHperDeviceRole::Standalone;

    UPROPERTY(Transient)
    FString RoomId;

    UPROPERTY(Transient)
    FString SessionId;

    UPROPERTY(Transient)
    FString WorldId;

    UPROPERTY(Transient)
    EUEHperSessionPhase SessionPhase = EUEHperSessionPhase::Idle;

    UPROPERTY(Transient)
    EUEHperTopologyPhase TopologyPhase = EUEHperTopologyPhase::Idle;

    UPROPERTY(Transient)
    FString AuthorityDeviceId;

    UPROPERTY(Transient)
    int32 PlayerCount = 0;

    UPROPERTY(Transient)
    FString LastCommandId;

    /** 检查状态是否实际变化，变化时广播委托 */
    void BroadcastIfChanged(EUEHperDeviceRole PrevRole, EUEHperSessionPhase PrevPhase);
};
