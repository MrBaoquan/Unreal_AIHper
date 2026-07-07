#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/EngineBaseTypes.h"
#include "PuertsNamespaceDef.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperRuntimeSubsystem.generated.h"

namespace PUERTS_NAMESPACE
{
class FJsEnv;
}

class UNetDriver;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FUEHperWorldLifecycleEvent, UWorld*, World, const FUEHperWorldContextInfo&, WorldContextInfo);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FUEHperWorldTickEvent, UWorld*, World, const FUEHperWorldContextInfo&, WorldContextInfo, float, DeltaSeconds);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FUEHperRuntimeLifecycleEvent);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FUEHperRuntimeStateChangedEvent, EUEHperRuntimeState, OldState, EUEHperRuntimeState, NewState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FUEHperNetworkFailureEvent, UWorld*, World, const FUEHperNetworkFailureInfo&, FailureInfo);

UCLASS()
class UEHPER_API UUEHperRuntimeSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    bool StartRuntime();

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void ShutdownRuntime();

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    bool RestartRuntime();

    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime")
    EUEHperRuntimeState GetRuntimeState() const;

    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime")
    FString GetLastError() const;

    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime")
    FString GetFrameworkModule() const;

    UFUNCTION(BlueprintPure, Category = "UEHper|Runtime")
    FString GetEntryModule() const;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperWorldLifecycleEvent OnUEHperWorldInitialized;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperWorldLifecycleEvent OnUEHperWorldBeginPlay;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperWorldTickEvent OnUEHperWorldTick;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperWorldLifecycleEvent OnUEHperWorldCleanup;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperNetworkFailureEvent OnUEHperNetworkFailure;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperRuntimeLifecycleEvent OnUEHperRuntimeShutdown;

    /** Broadcasts whenever the runtime state machine transitions (covers Initializing/RuntimeReady/.../Running/Failed/ShuttingDown/Shutdown). */
    UPROPERTY(BlueprintAssignable, Category = "UEHper|Runtime")
    FUEHperRuntimeStateChangedEvent OnUEHperRuntimeStateChanged;

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyWorldInitialized(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyWorldBeginPlay(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyWorldTick(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo, float DeltaSeconds);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyWorldCleanup(UWorld* World, const FUEHperWorldContextInfo& WorldContextInfo);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyNetworkFailure(UWorld* World, const FUEHperNetworkFailureInfo& FailureInfo);

    /** TS bootstrap reports completion. Transitions AppCreated -> Running on success, -> Failed on failure. */
    UFUNCTION(BlueprintCallable, Category = "UEHper|Runtime")
    void NotifyBootstrapResult(bool bSuccess, const FString& Error);

private:
    void HandleNetworkFailure(UWorld* World, UNetDriver* NetDriver, ENetworkFailure::Type FailureType, const FString& ErrorString);
    void SetRuntimeState(EUEHperRuntimeState NewState);
    void FailRuntime(const FString& ErrorMessage);
    bool LoadFrameworkModule();
    void ArmBootstrapWatchdog();
    void CancelBootstrapWatchdog();

private:
    TSharedPtr<PUERTS_NAMESPACE::FJsEnv> JsEnv;
    EUEHperRuntimeState RuntimeState = EUEHperRuntimeState::Uninitialized;
    FString LastError;
    FString FrameworkModule;
    FString EntryModule;
    FTSTicker::FDelegateHandle BootstrapWatchdogHandle;
    FDelegateHandle NetworkFailureHandle;
    float BootstrapTimeoutSeconds = 0.f;
};
