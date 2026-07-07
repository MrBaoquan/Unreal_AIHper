#include "UEHperRuntimeBlueprintLibrary.h"

#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "UEHperRuntimeSubsystem.h"

namespace
{
    UUEHperRuntimeSubsystem* ResolveRuntimeSubsystem(const UObject* WorldContextObject)
    {
        if (!WorldContextObject)
        {
            return nullptr;
        }
        const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
        if (!World)
        {
            return nullptr;
        }
        UGameInstance* GameInstance = World->GetGameInstance();
        if (!GameInstance)
        {
            return nullptr;
        }
        return GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>();
    }
}

EUEHperRuntimeState UUEHperRuntimeBlueprintLibrary::GetCurrentRuntimeState(const UObject* WorldContextObject)
{
    if (const UUEHperRuntimeSubsystem* Subsystem = ResolveRuntimeSubsystem(WorldContextObject))
    {
        return Subsystem->GetRuntimeState();
    }
    return EUEHperRuntimeState::Uninitialized;
}

UUEHperRuntimeSubsystem* UUEHperRuntimeBlueprintLibrary::GetUEHperRuntimeSubsystem(const UObject* WorldContextObject)
{
    // Stage 7.6: 直接暴露 subsystem 给 BP，便于绑定 OnUEHperRuntimeStateChanged 等 BlueprintAssignable 委托。
    return ResolveRuntimeSubsystem(WorldContextObject);
}

FString UUEHperRuntimeBlueprintLibrary::GetCurrentRuntimeStateName(const UObject* WorldContextObject)
{
    // Stage 7.1: 复用 UEHperRuntimeTypes.h 中内联的 LexToString，消除双源 switch。
    return FString(LexToString(GetCurrentRuntimeState(WorldContextObject)));
}

FString UUEHperRuntimeBlueprintLibrary::GetLastRuntimeError(const UObject* WorldContextObject)
{
    if (const UUEHperRuntimeSubsystem* Subsystem = ResolveRuntimeSubsystem(WorldContextObject))
    {
        return Subsystem->GetLastError();
    }
    return FString();
}

bool UUEHperRuntimeBlueprintLibrary::IsRuntimeRunning(const UObject* WorldContextObject)
{
    return GetCurrentRuntimeState(WorldContextObject) == EUEHperRuntimeState::Running;
}

bool UUEHperRuntimeBlueprintLibrary::IsRuntimeFailed(const UObject* WorldContextObject)
{
    return GetCurrentRuntimeState(WorldContextObject) == EUEHperRuntimeState::Failed;
}
