#include "UEHperWorldSubsystem.h"

#include "Engine/World.h"
#include "UEHperRuntimeSubsystem.h"

void UUEHperWorldSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);

    CachedWorldContextInfo = BuildWorldContextInfo();

    if (UWorld* World = GetWorld())
    {
        if (UGameInstance* GameInstance = World->GetGameInstance())
        {
            if (UUEHperRuntimeSubsystem* RuntimeSubsystem = GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>())
            {
                RuntimeSubsystem->NotifyWorldInitialized(World, CachedWorldContextInfo);
            }
        }
    }
}

void UUEHperWorldSubsystem::Deinitialize()
{
    if (UWorld* World = GetWorld())
    {
        if (UGameInstance* GameInstance = World->GetGameInstance())
        {
            if (UUEHperRuntimeSubsystem* RuntimeSubsystem = GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>())
            {
                RuntimeSubsystem->NotifyWorldCleanup(World, CachedWorldContextInfo);
            }
        }
    }

    Super::Deinitialize();
}

void UUEHperWorldSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
    CachedWorldContextInfo = BuildWorldContextInfo();

    if (UGameInstance* GameInstance = InWorld.GetGameInstance())
    {
        if (UUEHperRuntimeSubsystem* RuntimeSubsystem = GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>())
        {
            RuntimeSubsystem->NotifyWorldBeginPlay(&InWorld, CachedWorldContextInfo);
        }
    }
}

void UUEHperWorldSubsystem::Tick(float DeltaTime)
{
    UWorld* World = GetWorld();
    if (!World || DeltaTime <= 0.f)
    {
        return;
    }

    if (UGameInstance* GameInstance = World->GetGameInstance())
    {
        if (UUEHperRuntimeSubsystem* RuntimeSubsystem = GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>())
        {
            RuntimeSubsystem->NotifyWorldTick(World, CachedWorldContextInfo, DeltaTime);
        }
    }
}

TStatId UUEHperWorldSubsystem::GetStatId() const
{
    RETURN_QUICK_DECLARE_CYCLE_STAT(UUEHperWorldSubsystem, STATGROUP_Tickables);
}

FUEHperWorldContextInfo UUEHperWorldSubsystem::GetWorldContextInfo() const
{
    return CachedWorldContextInfo;
}

FUEHperWorldContextInfo UUEHperWorldSubsystem::BuildWorldContextInfo() const
{
    FUEHperWorldContextInfo Info;

    const UWorld* World = GetWorld();
    if (!World)
    {
        return Info;
    }

    Info.WorldName = World->GetName();
    switch (World->WorldType)
    {
    case EWorldType::Game:
        Info.WorldType = TEXT("Game");
        break;
    case EWorldType::PIE:
        Info.WorldType = TEXT("PIE");
        break;
    case EWorldType::Editor:
        Info.WorldType = TEXT("Editor");
        break;
    case EWorldType::EditorPreview:
        Info.WorldType = TEXT("EditorPreview");
        break;
    case EWorldType::GamePreview:
        Info.WorldType = TEXT("GamePreview");
        break;
    case EWorldType::GameRPC:
        Info.WorldType = TEXT("GameRPC");
        break;
    case EWorldType::Inactive:
        Info.WorldType = TEXT("Inactive");
        break;
    default:
        Info.WorldType = TEXT("Unknown");
        break;
    }
    Info.bIsPIE = World->WorldType == EWorldType::PIE;
    Info.PIEInstanceId = World->GetOutermost() ? World->GetOutermost()->GetPIEInstanceID() : INDEX_NONE;
    Info.bHasAuthority = !World->IsNetMode(NM_Client);
    Info.WorldId = FString::Printf(TEXT("%s_%d_%p"), *Info.WorldName, Info.PIEInstanceId, World);

    return Info;
}
