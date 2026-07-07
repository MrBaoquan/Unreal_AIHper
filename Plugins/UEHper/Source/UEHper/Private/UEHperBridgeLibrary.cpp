#include "UEHperBridgeLibrary.h"

#include "Engine/Engine.h"
#include "Engine/World.h"
#include "Blueprint/UserWidget.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "UEHperResourceSubsystem.h"
#include "UEHperRuntimeSubsystem.h"
#include "UEHperLevelStreamingWatcher.h"
#include "UEHperSettings.h"
#include "UEHperUIWorldHostActor.h"

#if WITH_EDITOR
#include "Editor.h"
#endif

UUEHperRuntimeSubsystem* UUEHperBridgeLibrary::GetRuntimeSubsystem(const UObject* WorldContextObject)
{
    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    if (!World)
    {
        return nullptr;
    }

    UGameInstance* GameInstance = World->GetGameInstance();
    return GameInstance ? GameInstance->GetSubsystem<UUEHperRuntimeSubsystem>() : nullptr;
}

UUEHperResourceSubsystem* UUEHperBridgeLibrary::GetResourceSubsystem(const UObject* WorldContextObject)
{
    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    if (!World)
    {
        return nullptr;
    }

    UGameInstance* GameInstance = World->GetGameInstance();
    return GameInstance ? GameInstance->GetSubsystem<UUEHperResourceSubsystem>() : nullptr;
}

UUEHperLevelStreamingWatcher* UUEHperBridgeLibrary::GetLevelStreamingWatcher(const UObject* WorldContextObject)
{
    // P4-H: 直接通过 World->GetSubsystem 获取 WorldSubsystem
    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    return World ? World->GetSubsystem<UUEHperLevelStreamingWatcher>() : nullptr;
}

EUEHperRuntimeState UUEHperBridgeLibrary::GetRuntimeState(const UObject* WorldContextObject)
{
    if (const UUEHperRuntimeSubsystem* RuntimeSubsystem = GetRuntimeSubsystem(WorldContextObject))
    {
        return RuntimeSubsystem->GetRuntimeState();
    }

    return EUEHperRuntimeState::Uninitialized;
}

UWorld* UUEHperBridgeLibrary::ResolveWorldFromObject(const UObject* WorldContextObject)
{
    if (!WorldContextObject || !GEngine)
    {
        return nullptr;
    }

    return GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull);
}

FUEHperWorldContextInfo UUEHperBridgeLibrary::GetWorldContextInfo(const UObject* WorldContextObject)
{
    return BuildWorldContextInfo(ResolveWorldFromObject(WorldContextObject));
}

APlayerController* UUEHperBridgeLibrary::GetPrimaryPlayerController(const UObject* WorldContextObject)
{
    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    return World ? UGameplayStatics::GetPlayerController(World, 0) : nullptr;
}

bool UUEHperBridgeLibrary::IsValidObject(const UObject* Object)
{
    return IsValid(Object);
}

UObject* UUEHperBridgeLibrary::LoadObjectBySoftPath(TSoftObjectPtr<UObject> ObjectPath)
{
    return ObjectPath.LoadSynchronous();
}

UClass* UUEHperBridgeLibrary::LoadClassBySoftPath(TSoftClassPtr<UObject> ClassPath)
{
    return ClassPath.LoadSynchronous();
}

UObject* UUEHperBridgeLibrary::LoadObjectByPath(const FString& ObjectPath, bool& bSuccess, FString& ErrorMessage)
{
    bSuccess = false;
    ErrorMessage.Reset();

    if (ObjectPath.IsEmpty())
    {
        ErrorMessage = TEXT("ObjectPath is empty.");
        return nullptr;
    }

    FSoftObjectPath SoftObjectPath(ObjectPath);
    if (!SoftObjectPath.IsValid())
    {
        ErrorMessage = FString::Printf(TEXT("Invalid object path: %s"), *ObjectPath);
        return nullptr;
    }

    UObject* Object = SoftObjectPath.TryLoad();
    bSuccess = IsValid(Object);
    if (!bSuccess)
    {
        ErrorMessage = FString::Printf(TEXT("Failed to load object: %s"), *ObjectPath);
    }

    return Object;
}

UClass* UUEHperBridgeLibrary::LoadClassByPath(const FString& ClassPath, bool& bSuccess, FString& ErrorMessage)
{
    bSuccess = false;
    ErrorMessage.Reset();

    if (ClassPath.IsEmpty())
    {
        ErrorMessage = TEXT("ClassPath is empty.");
        return nullptr;
    }

    FSoftClassPath SoftClassPath(ClassPath);
    if (!SoftClassPath.IsValid())
    {
        ErrorMessage = FString::Printf(TEXT("Invalid class path: %s"), *ClassPath);
        return nullptr;
    }

    UClass* Class = SoftClassPath.TryLoadClass<UObject>();
    bSuccess = IsValid(Class);
    if (!bSuccess)
    {
        ErrorMessage = FString::Printf(TEXT("Failed to load class: %s"), *ClassPath);
    }

    return Class;
}

UUserWidget* UUEHperBridgeLibrary::CreateWidgetSafe(const UObject* WorldContextObject, TSubclassOf<UUserWidget> WidgetClass, APlayerController* OwningPlayer, bool& bSuccess, FString& ErrorMessage)
{
    bSuccess = false;
    ErrorMessage.Reset();

    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    if (!World)
    {
        ErrorMessage = TEXT("Cannot create widget without a valid World.");
        return nullptr;
    }

    if (!WidgetClass)
    {
        ErrorMessage = TEXT("Cannot create widget without a valid WidgetClass.");
        return nullptr;
    }

    APlayerController* ActualOwningPlayer = OwningPlayer ? OwningPlayer : UGameplayStatics::GetPlayerController(World, 0);
    UUserWidget* Widget = ActualOwningPlayer ? CreateWidget<UUserWidget>(ActualOwningPlayer, WidgetClass) : CreateWidget<UUserWidget>(World, WidgetClass);
    bSuccess = IsValid(Widget);
    if (!bSuccess)
    {
        ErrorMessage = FString::Printf(TEXT("Failed to create widget from class: %s"), *GetNameSafe(*WidgetClass));
    }

    return Widget;
}

bool UUEHperBridgeLibrary::OpenLevelSafe(const UObject* WorldContextObject, FName LevelName, FString& ErrorMessage)
{
    ErrorMessage.Reset();

    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    if (!World)
    {
        ErrorMessage = TEXT("Cannot open level without a valid World.");
        return false;
    }

    if (LevelName.IsNone())
    {
        ErrorMessage = TEXT("Cannot open level with an empty LevelName.");
        return false;
    }

    UGameplayStatics::OpenLevel(World, LevelName);
    return true;
}

void UUEHperBridgeLibrary::ReportFrameworkError(const FString& Code, const FString& Message, const FString& Detail)
{
    UE_LOG(LogTemp, Error, TEXT("[UEHper][%s] %s %s"), *Code, *Message, *Detail);
}

bool UUEHperBridgeLibrary::IsVRPreviewActive()
{
#if WITH_EDITOR
    if (UEditorEngine* EditorEngine = Cast<UEditorEngine>(GEngine))
    {
        return EditorEngine->IsVRPreviewActive();
    }
#endif
    return false;
}

bool UUEHperBridgeLibrary::IsPlayInEditor()
{
#if WITH_EDITOR
    if (GEngine)
    {
        for (const FWorldContext& Ctx : GEngine->GetWorldContexts())
        {
            if (Ctx.WorldType == EWorldType::PIE)
            {
                return true;
            }
        }
    }
#endif
    return false;
}

FUEHperWorldContextInfo UUEHperBridgeLibrary::BuildWorldContextInfo(const UWorld* World)
{
    FUEHperWorldContextInfo Info;
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
    Info.WorldId = FString::Printf(TEXT("%s_%d_%p"), *Info.WorldName, Info.PIEInstanceId, World);
    return Info;
}

// ──────────────────────────────────────────────────────────────────────
// World UI Host
// ──────────────────────────────────────────────────────────────────────

AUEHperUIWorldHostActor* UUEHperBridgeLibrary::ResolveUIWorldHost(const UObject* WorldContextObject)
{
    UWorld* World = ResolveWorldFromObject(WorldContextObject);
    if (!World)
    {
        return nullptr;
    }

    // 1) 解析业务覆盖类（DefaultUIWorldHostClass），未设置则用框架基类
    TSubclassOf<AUEHperUIWorldHostActor> HostClass = AUEHperUIWorldHostActor::StaticClass();
    if (const UUEHperSettings* Settings = GetDefault<UUEHperSettings>())
    {
        if (Settings->DefaultUIWorldHostClass.IsValid())
        {
            if (UClass* LoadedClass = Settings->DefaultUIWorldHostClass.TryLoadClass<AUEHperUIWorldHostActor>())
            {
                HostClass = LoadedClass;
            }
        }
    }

    // 2) 优先查找业务子类实例；找不到再退化到框架基类实例
    AUEHperUIWorldHostActor* Found = nullptr;
    for (TActorIterator<AUEHperUIWorldHostActor> It(World, HostClass); It; ++It)
    {
        if (IsValid(*It))
        {
            Found = *It;
            break;
        }
    }
    if (!Found && HostClass != AUEHperUIWorldHostActor::StaticClass())
    {
        for (TActorIterator<AUEHperUIWorldHostActor> It(World); It; ++It)
        {
            if (IsValid(*It))
            {
                Found = *It;
                break;
            }
        }
    }

    if (Found)
    {
        return Found;
    }

    // 3) 都没有 → SpawnActor。位置随便给原点，后续 AttachPanel 会重新 snapshot。
    FActorSpawnParameters Params;
    Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
    Params.ObjectFlags |= RF_Transient;
    AUEHperUIWorldHostActor* Spawned = World->SpawnActor<AUEHperUIWorldHostActor>(HostClass, FVector::ZeroVector, FRotator::ZeroRotator, Params);
    if (!Spawned)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperBridge] ResolveUIWorldHost: SpawnActor failed (HostClass=%s)"), *GetNameSafe(HostClass));
    }
    return Spawned;
}

UUserWidget* UUEHperBridgeLibrary::AttachPanelToHost(AUEHperUIWorldHostActor* Host,
                                                    TSubclassOf<UUserWidget> WidgetClass,
                                                    FName PanelKey,
                                                    APlayerController* OwningPlayer,
                                                    float DistanceCm,
                                                    float PitchOffsetDeg,
                                                    bool bFaceCameraOnSpawn,
                                                    float DrawSizeX,
                                                    float DrawSizeY,
                                                    float Scale,
                                                    float OffsetRightCm,
                                                    float OffsetUpCm)
{
    if (!Host)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperBridge] AttachPanelToHost: Host is null"));
        return nullptr;
    }
    return Host->AttachPanel(WidgetClass, PanelKey, OwningPlayer, DistanceCm, PitchOffsetDeg, bFaceCameraOnSpawn, DrawSizeX, DrawSizeY, Scale, OffsetRightCm, OffsetUpCm);
}

void UUEHperBridgeLibrary::DetachPanelFromHost(AUEHperUIWorldHostActor* Host, FName PanelKey)
{
    if (!Host)
    {
        return;
    }
    Host->DetachPanel(PanelKey);
}
