#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "UEHperJsonSaveGame.generated.h"

UCLASS(BlueprintType)
class UEHPER_API UUEHperJsonSaveGame : public USaveGame
{
    GENERATED_BODY()

public:
    UPROPERTY(BlueprintReadWrite, Category = "UEHper|SaveGame")
    int32 SchemaVersion = 1;

    UPROPERTY(BlueprintReadWrite, Category = "UEHper|SaveGame")
    FString PayloadJson;
};
