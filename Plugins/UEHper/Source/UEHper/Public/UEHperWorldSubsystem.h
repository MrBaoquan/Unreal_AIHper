#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperWorldSubsystem.generated.h"

UCLASS()
class UEHPER_API UUEHperWorldSubsystem : public UTickableWorldSubsystem
{
    GENERATED_BODY()

public:
    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;
    virtual void OnWorldBeginPlay(UWorld& InWorld) override;
    virtual void Tick(float DeltaTime) override;
    virtual TStatId GetStatId() const override;

    UFUNCTION(BlueprintPure, Category = "UEHper|World")
    FUEHperWorldContextInfo GetWorldContextInfo() const;

private:
    FUEHperWorldContextInfo BuildWorldContextInfo() const;

private:
    FUEHperWorldContextInfo CachedWorldContextInfo;
};
