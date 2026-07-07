#pragma once

#include "CoreMinimal.h"
#include "Engine/StreamableManager.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperResourceSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FUEHperAsyncLoadCompletedEvent, const FUEHperAsyncLoadResult&, Result);

USTRUCT()
struct FUEHperAsyncLoadRequest
{
    GENERATED_BODY()

    FString RequestId;
    FString AssetPath;
    bool bIsClass = false;
    EUEHperAsyncLoadStatus Status = EUEHperAsyncLoadStatus::None;
};

UCLASS()
class UEHPER_API UUEHperResourceSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    virtual void Deinitialize() override;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|Resource")
    FUEHperAsyncLoadCompletedEvent OnAsyncLoadCompleted;

    UFUNCTION(BlueprintCallable, Category = "UEHper|Resource")
    bool RequestAsyncLoadObject(const FString& RequestId, const FString& ObjectPath, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Resource")
    bool RequestAsyncLoadClass(const FString& RequestId, const FString& ClassPath, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Resource")
    bool CancelAsyncLoad(const FString& RequestId);

    UFUNCTION(BlueprintPure, Category = "UEHper|Resource")
    EUEHperAsyncLoadStatus GetAsyncLoadStatus(const FString& RequestId) const;

    UFUNCTION(BlueprintCallable, Category = "UEHper|Resource")
    void ReleaseAsyncLoadHandle(const FString& RequestId);

private:
    bool RequestAsyncLoad(const FString& RequestId, const FString& AssetPath, bool bIsClass, FString& ErrorMessage);
    void HandleAsyncLoadCompleted(FString RequestId);
    void CompleteRequest(const FUEHperAsyncLoadResult& Result, EUEHperAsyncLoadStatus Status);
    bool ValidateRequest(const FString& RequestId, const FString& AssetPath, FString& ErrorMessage) const;

private:
    FStreamableManager StreamableManager;
    TMap<FString, FUEHperAsyncLoadRequest> Requests;
    TMap<FString, TSharedPtr<FStreamableHandle>> ActiveHandles;
};