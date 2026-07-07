#pragma once

#include "CoreMinimal.h"
#include "UEHperRuntimeTypes.generated.h"

UENUM(BlueprintType)
enum class EUEHperRuntimeState : uint8
{
    Uninitialized,
    Initializing,
    RuntimeReady,
    FrameworkLoaded,
    AppCreated,
    Running,
    Failed,
    ShuttingDown,
    Shutdown
};

/**
 * Stage 7.1: 公开 LexToString(EUEHperRuntimeState)，消除 UEHperRuntimeSubsystem.cpp 与
 * UEHperRuntimeBlueprintLibrary.cpp 之前的双源 switch；新增枚举项时只需在此处增删一处。
 * 内联实现以避免依赖任何 cpp 链接。
 */
inline const TCHAR* LexToString(EUEHperRuntimeState State)
{
    switch (State)
    {
        case EUEHperRuntimeState::Uninitialized:   return TEXT("Uninitialized");
        case EUEHperRuntimeState::Initializing:    return TEXT("Initializing");
        case EUEHperRuntimeState::RuntimeReady:    return TEXT("RuntimeReady");
        case EUEHperRuntimeState::FrameworkLoaded: return TEXT("FrameworkLoaded");
        case EUEHperRuntimeState::AppCreated:      return TEXT("AppCreated");
        case EUEHperRuntimeState::Running:         return TEXT("Running");
        case EUEHperRuntimeState::Failed:          return TEXT("Failed");
        case EUEHperRuntimeState::ShuttingDown:    return TEXT("ShuttingDown");
        case EUEHperRuntimeState::Shutdown:        return TEXT("Shutdown");
    }
    return TEXT("Unknown");
}

UENUM(BlueprintType)
enum class EUEHperStartupPolicy : uint8
{
    Auto,
    Manual,
    Disabled
};

UENUM(BlueprintType)
enum class EUEHperRuntimeScope : uint8
{
    GameInstance,
    PerWorld
};

UENUM(BlueprintType)
enum class EUEHperWorldContextPolicy : uint8
{
    PIEIsolated,
    SharedRuntimeWithWorldContexts
};

UENUM(BlueprintType)
enum class EUEHperAsyncLoadStatus : uint8
{
    None,
    Loading,
    Completed,
    Failed,
    Canceled
};

USTRUCT(BlueprintType)
struct UEHPER_API FUEHperWorldContextInfo
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    FString WorldId;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    FString WorldName;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    FString WorldType;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    bool bIsPIE = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    int32 PIEInstanceId = INDEX_NONE;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper")
    bool bHasAuthority = true;
};

USTRUCT(BlueprintType)
struct UEHPER_API FUEHperNetworkFailureInfo
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Network")
    FUEHperWorldContextInfo WorldContextInfo;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Network")
    FString FailureType;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Network")
    FString ErrorString;
};

USTRUCT(BlueprintType)
struct UEHPER_API FUEHperAsyncLoadResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    FString RequestId;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    FString AssetPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    bool bSuccess = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    bool bIsClass = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    TObjectPtr<UObject> Object = nullptr;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    TObjectPtr<UClass> Class = nullptr;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Resource")
    FString ErrorMessage;
};

USTRUCT(BlueprintType)
struct UEHPER_API FUEHperAssetDiagnosticResult
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString InputPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString ObjectPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString PackagePath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString AssetName;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString AssetClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString NativeParentClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString GeneratedClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString LoadedClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString LoadedObjectClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString BlueprintParentClassPath;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bExists = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsGameAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsBlueprintAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsWidgetBlueprint = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bClassLoadSucceeded = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bObjectLoadSucceeded = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsUserWidgetClass = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bGeneratedClassIsDataAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bGeneratedClassIsPrimaryDataAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bGeneratedClassIsAnimInstance = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsDataAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsPrimaryDataAsset = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    bool bIsAnimBlueprint = false;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString ClassLoadErrorMessage;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString ObjectLoadErrorMessage;

    UPROPERTY(BlueprintReadOnly, Category = "UEHper|Asset")
    FString ErrorMessage;
};
