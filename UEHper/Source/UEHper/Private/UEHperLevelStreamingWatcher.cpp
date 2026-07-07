/**
 * UEHperLevelStreamingWatcher - 关卡流式加载监听 WorldSubsystem 实现 (P4-H 新增)
 */
#include "UEHperLevelStreamingWatcher.h"
#include "Engine/World.h"
#include "Engine/Level.h"

void UUEHperLevelStreamingWatcher::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);

    LevelAddedHandle = FWorldDelegates::LevelAddedToWorld.AddUObject(
        this, &UUEHperLevelStreamingWatcher::HandleLevelAddedToWorld);
    LevelRemovedHandle = FWorldDelegates::LevelRemovedFromWorld.AddUObject(
        this, &UUEHperLevelStreamingWatcher::HandleLevelRemovedFromWorld);

    UE_LOG(LogTemp, Log, TEXT("[UEHperLevelWatcher] Initialized for world %s"),
        *GetNameSafe(GetWorld()));
}

void UUEHperLevelStreamingWatcher::Deinitialize()
{
    FWorldDelegates::LevelAddedToWorld.Remove(LevelAddedHandle);
    FWorldDelegates::LevelRemovedFromWorld.Remove(LevelRemovedHandle);
    LevelAddedHandle.Reset();
    LevelRemovedHandle.Reset();

    UE_LOG(LogTemp, Log, TEXT("[UEHperLevelWatcher] Deinitialized for world %s"),
        *GetNameSafe(GetWorld()));

    Super::Deinitialize();
}

void UUEHperLevelStreamingWatcher::HandleLevelAddedToWorld(ULevel* InLevel, UWorld* InWorld)
{
    // 过滤其他 World 的事件（PIE 多窗口隔离）
    if (InWorld != GetWorld() || InLevel == nullptr)
    {
        return;
    }
    const FString LevelName = InLevel->GetOutermost()->GetName();
    UE_LOG(LogTemp, Verbose, TEXT("[UEHperLevelWatcher] LevelAdded: %s"), *LevelName);
    OnLevelAdded.Broadcast(LevelName);
}

void UUEHperLevelStreamingWatcher::HandleLevelRemovedFromWorld(ULevel* InLevel, UWorld* InWorld)
{
    if (InWorld != GetWorld() || InLevel == nullptr)
    {
        return;
    }
    const FString LevelName = InLevel->GetOutermost()->GetName();
    UE_LOG(LogTemp, Verbose, TEXT("[UEHperLevelWatcher] LevelRemoved: %s"), *LevelName);
    OnLevelRemoved.Broadcast(LevelName);
}
