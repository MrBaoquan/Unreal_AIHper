/**
 * UEHperLevelStreamingWatcher - 关卡流式加载监听 WorldSubsystem (P4-H 新增)
 *
 * 用途：桥接 FWorldDelegates::LevelAddedToWorld / LevelRemovedFromWorld 到 TS 业务层
 *
 * 设计：
 * - L0 框架层 WorldSubsystem，跟随 World 生命周期
 * - 在 Initialize 时绑定 FWorldDelegates，Deinitialize 时解绑
 * - TS 业务层通过 OnLevelAdded / OnLevelRemoved Dynamic Multicast Delegate 监听
 * - 仅广播本 World 范围内的事件，避免 PIE 多窗口串扰
 *
 * 业务边界：本子系统只负责事件桥接，不维护任何业务状态。
 */
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "UEHperLevelStreamingWatcher.generated.h"

class ULevel;
class UWorld;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FUEHperOnLevelStreamingChanged, const FString&, LevelName);

UCLASS(BlueprintType)
class UEHPER_API UUEHperLevelStreamingWatcher : public UWorldSubsystem
{
    GENERATED_BODY()

public:
    /** Level 加入 World 时触发（流加载完成） */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|LevelStreaming")
    FUEHperOnLevelStreamingChanged OnLevelAdded;

    /** Level 从 World 移除时触发（流卸载） */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|LevelStreaming")
    FUEHperOnLevelStreamingChanged OnLevelRemoved;

    // UWorldSubsystem
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

private:
    /** FWorldDelegates 回调：Level 加入 */
    void HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld);
    /** FWorldDelegates 回调：Level 移除 */
    void HandleLevelRemovedFromWorld(ULevel* InLevel, UWorld* InWorld);

    FDelegateHandle LevelAddedHandle;
    FDelegateHandle LevelRemovedHandle;
};
