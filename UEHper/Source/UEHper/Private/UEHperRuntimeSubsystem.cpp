#include "UEHperRuntimeSubsystem.h"

#include "Engine\Engine.h"
#include "Engine\NetDriver.h"
#include "JsEnv.h"
#include "UEHperBridgeLibrary.h"
#include "UEHperSettings.h"

DEFINE_LOG_CATEGORY_STATIC(LogUEHperRuntime, Log, All);

// Stage 7.1: LexToString(EUEHperRuntimeState) 已迁移到 Public/UEHperRuntimeTypes.h 公开内联。

void UUEHperRuntimeSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
    Super::Initialize(Collection);

    const UUEHperSettings* Settings = GetDefault<UUEHperSettings>();
    FrameworkModule = Settings->FrameworkModule;
    EntryModule = Settings->EntryModule;

    if (!Settings->bEnableUEHperRuntime || Settings->StartupPolicy == EUEHperStartupPolicy::Disabled)
    {
        SetRuntimeState(EUEHperRuntimeState::Shutdown);
        UE_LOG(LogUEHperRuntime, Display, TEXT("UEHper runtime disabled."));
        return;
    }

#if WITH_EDITOR
    if (!Settings->bEnableEditorRuntime && GIsEditor)
    {
        SetRuntimeState(EUEHperRuntimeState::Shutdown);
        UE_LOG(LogUEHperRuntime, Display, TEXT("UEHper editor runtime disabled."));
        return;
    }
#endif

    SetRuntimeState(EUEHperRuntimeState::Uninitialized);

    if (GEngine && !NetworkFailureHandle.IsValid())
    {
        NetworkFailureHandle = GEngine->OnNetworkFailure().AddUObject(this, &UUEHperRuntimeSubsystem::HandleNetworkFailure);
    }

    if (Settings->StartupPolicy == EUEHperStartupPolicy::Auto)
    {
        StartRuntime();
    }
}

void UUEHperRuntimeSubsystem::Deinitialize()
{
    if (GEngine && NetworkFailureHandle.IsValid())
    {
        GEngine->OnNetworkFailure().Remove(NetworkFailureHandle);
        NetworkFailureHandle.Reset();
    }

    ShutdownRuntime();
    Super::Deinitialize();
}

bool UUEHperRuntimeSubsystem::StartRuntime()
{
    if (RuntimeState == EUEHperRuntimeState::Running || RuntimeState == EUEHperRuntimeState::Initializing)
    {
        return true;
    }

    const UUEHperSettings* Settings = GetDefault<UUEHperSettings>();
    if (!Settings->bEnableUEHperRuntime)
    {
        SetRuntimeState(EUEHperRuntimeState::Shutdown);
        return false;
    }

    SetRuntimeState(EUEHperRuntimeState::Initializing);
    LastError.Reset();
    FrameworkModule = Settings->FrameworkModule;
    EntryModule = Settings->EntryModule;

    if (FrameworkModule.IsEmpty())
    {
        FailRuntime(TEXT("UEHper FrameworkModule is empty."));
        return false;
    }

    JsEnv = MakeShared<PUERTS_NAMESPACE::FJsEnv>(Settings->ScriptRoot).ToSharedPtr();
    SetRuntimeState(EUEHperRuntimeState::RuntimeReady);

    return LoadFrameworkModule();
}

void UUEHperRuntimeSubsystem::ShutdownRuntime()
{
    CancelBootstrapWatchdog();

    if (RuntimeState == EUEHperRuntimeState::Shutdown || RuntimeState == EUEHperRuntimeState::Uninitialized)
    {
        JsEnv.Reset();
        SetRuntimeState(EUEHperRuntimeState::Shutdown);
        return;
    }

    SetRuntimeState(EUEHperRuntimeState::ShuttingDown);
    OnUEHperRuntimeShutdown.Broadcast();
    JsEnv.Reset();
    SetRuntimeState(EUEHperRuntimeState::Shutdown);
    UE_LOG(LogUEHperRuntime, Display, TEXT("UEHper runtime shutdown."));
}

bool UUEHperRuntimeSubsystem::RestartRuntime()
{
    ShutdownRuntime();
    SetRuntimeState(EUEHperRuntimeState::Uninitialized);
    return StartRuntime();
}

EUEHperRuntimeState UUEHperRuntimeSubsystem::GetRuntimeState() const
{
    return RuntimeState;
}

FString UUEHperRuntimeSubsystem::GetLastError() const
{
    return LastError;
}

FString UUEHperRuntimeSubsystem::GetFrameworkModule() const
{
    return FrameworkModule;
}

FString UUEHperRuntimeSubsystem::GetEntryModule() const
{
    return EntryModule;
}

void UUEHperRuntimeSubsystem::NotifyWorldInitialized(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo)
{
    if (!World)
    {
        return;
    }

    UE_LOG(LogUEHperRuntime, Display, TEXT("World initialized: %s (%s)"), *WorldContextInfo.WorldName, *WorldContextInfo.WorldId);
    OnUEHperWorldInitialized.Broadcast(World, WorldContextInfo);
}

void UUEHperRuntimeSubsystem::NotifyWorldBeginPlay(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo)
{
    if (!World)
    {
        return;
    }

    UE_LOG(LogUEHperRuntime, Display, TEXT("World begin play: %s (%s)"), *WorldContextInfo.WorldName, *WorldContextInfo.WorldId);
    OnUEHperWorldBeginPlay.Broadcast(World, WorldContextInfo);
}

void UUEHperRuntimeSubsystem::NotifyWorldTick(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo, float DeltaSeconds)
{
    if (!World || RuntimeState != EUEHperRuntimeState::Running || DeltaSeconds <= 0.f)
    {
        return;
    }

    OnUEHperWorldTick.Broadcast(World, WorldContextInfo, DeltaSeconds);
}

void UUEHperRuntimeSubsystem::NotifyWorldCleanup(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo)
{
    if (!World)
    {
        return;
    }

    UE_LOG(LogUEHperRuntime, Display, TEXT("World cleanup: %s (%s)"), *WorldContextInfo.WorldName, *WorldContextInfo.WorldId);
    OnUEHperWorldCleanup.Broadcast(World, WorldContextInfo);
}

void UUEHperRuntimeSubsystem::NotifyNetworkFailure(UWorld* World, const FUEHperNetworkFailureInfo& FailureInfo)
{
    UE_LOG(LogUEHperRuntime, Warning, TEXT("Network failure: Type=%s World=%s Error=%s"), *FailureInfo.FailureType, *FailureInfo.WorldContextInfo.WorldName, *FailureInfo.ErrorString);
    OnUEHperNetworkFailure.Broadcast(World, FailureInfo);
}

void UUEHperRuntimeSubsystem::NotifyBootstrapResult(bool bSuccess, const FString& Error)
{
    if (RuntimeState != EUEHperRuntimeState::AppCreated && RuntimeState != EUEHperRuntimeState::Running && RuntimeState != EUEHperRuntimeState::Failed)
    {
        UE_LOG(LogUEHperRuntime, Warning, TEXT("NotifyBootstrapResult ignored: unexpected RuntimeState=%d"), static_cast<int32>(RuntimeState));
        return;
    }

    CancelBootstrapWatchdog();

    if (bSuccess)
    {
        LastError.Empty();
        SetRuntimeState(EUEHperRuntimeState::Running);
        UE_LOG(LogUEHperRuntime, Display, TEXT("UEHper TS bootstrap ready."));
    }
    else
    {
        FailRuntime(Error.IsEmpty() ? TEXT("TS bootstrap failed") : Error);
    }
}

void UUEHperRuntimeSubsystem::HandleNetworkFailure(UWorld* World, UNetDriver* NetDriver, ENetworkFailure::Type FailureType, const FString& ErrorString)
{
    FUEHperNetworkFailureInfo FailureInfo;
    if (World)
    {
        FailureInfo.WorldContextInfo = UUEHperBridgeLibrary::GetWorldContextInfo(World);
    }

    FailureInfo.FailureType = ENetworkFailure::ToString(FailureType);

    FailureInfo.ErrorString = ErrorString;
    NotifyNetworkFailure(World, FailureInfo);
}

void UUEHperRuntimeSubsystem::SetRuntimeState(EUEHperRuntimeState NewState)
{
    if (RuntimeState == NewState)
    {
        return;
    }
    const EUEHperRuntimeState OldState = RuntimeState;
    RuntimeState = NewState;
    UE_LOG(LogUEHperRuntime, Display, TEXT("RuntimeState %s -> %s"), LexToString(OldState), LexToString(NewState));
    OnUEHperRuntimeStateChanged.Broadcast(OldState, NewState);
}

void UUEHperRuntimeSubsystem::FailRuntime(const FString& ErrorMessage)
{
    CancelBootstrapWatchdog();
    LastError = ErrorMessage;
    SetRuntimeState(EUEHperRuntimeState::Failed);
    UE_LOG(LogUEHperRuntime, Error, TEXT("%s"), *LastError);
}

bool UUEHperRuntimeSubsystem::LoadFrameworkModule()
{
    if (!JsEnv.IsValid())
    {
        FailRuntime(TEXT("Cannot load framework module without a valid JsEnv."));
        return false;
    }

    TArray<TPair<FString, UObject*>> Arguments;
    Arguments.Add(TPair<FString, UObject*>(TEXT("RuntimeSubsystem"), this));

    SetRuntimeState(EUEHperRuntimeState::FrameworkLoaded);
    SetRuntimeState(EUEHperRuntimeState::AppCreated);
    ArmBootstrapWatchdog();
    JsEnv->Start(FrameworkModule, Arguments);
    UE_LOG(LogUEHperRuntime, Display, TEXT("UEHper runtime module started. FrameworkModule=%s EntryModule=%s BootstrapState=%s"), *FrameworkModule, *EntryModule, RuntimeState == EUEHperRuntimeState::Running ? TEXT("ready") : TEXT("awaiting"));
    return true;
}

void UUEHperRuntimeSubsystem::ArmBootstrapWatchdog()
{
    CancelBootstrapWatchdog();

    const UUEHperSettings* Settings = GetDefault<UUEHperSettings>();
    BootstrapTimeoutSeconds = Settings ? Settings->BootstrapTimeoutSeconds : 0.f;
    if (BootstrapTimeoutSeconds <= 0.f)
    {
        return;
    }

    TWeakObjectPtr<UUEHperRuntimeSubsystem> WeakThis(this);
    const float TimeoutCopy = BootstrapTimeoutSeconds;
    BootstrapWatchdogHandle = FTSTicker::GetCoreTicker().AddTicker(
        FTickerDelegate::CreateLambda([WeakThis, TimeoutCopy](float /*DeltaTime*/) -> bool
        {
            if (UUEHperRuntimeSubsystem* Self = WeakThis.Get())
            {
                if (Self->RuntimeState == EUEHperRuntimeState::AppCreated)
                {
                    Self->BootstrapWatchdogHandle.Reset();
                    Self->FailRuntime(FString::Printf(TEXT("TS bootstrap timeout after %.1fs (no NotifyBootstrapResult)."), TimeoutCopy));
                }
            }
            return false;
        }),
        BootstrapTimeoutSeconds);
}

void UUEHperRuntimeSubsystem::CancelBootstrapWatchdog()
{
    if (BootstrapWatchdogHandle.IsValid())
    {
        FTSTicker::GetCoreTicker().RemoveTicker(BootstrapWatchdogHandle);
        BootstrapWatchdogHandle.Reset();
    }
}
