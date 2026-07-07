#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperAssetDiagnosticsLibrary.generated.h"

UCLASS()
class UEHPER_API UUEHperAssetDiagnosticsLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category = "UEHper|Asset")
    static bool GetAssetDiagnostic(const FString& AssetPath, FUEHperAssetDiagnosticResult& Result);

private:
    static FString NormalizeObjectPath(const FString& AssetPath);
    static FString BuildObjectPathFromPackagePath(const FString& PackagePath);
};