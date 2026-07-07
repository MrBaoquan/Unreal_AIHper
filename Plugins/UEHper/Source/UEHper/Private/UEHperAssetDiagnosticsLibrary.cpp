#include "UEHperAssetDiagnosticsLibrary.h"

#include "AssetRegistry/AssetData.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/AnimInstance.h"
#include "Engine/DataAsset.h"
#include "Engine/Blueprint.h"
#include "Blueprint/UserWidget.h"
#include "Modules/ModuleManager.h"

namespace
{
    FString GetAssetDataTagValue(const FAssetData& AssetData, const FName& TagName)
    {
        FString Value;
        AssetData.GetTagValue(TagName, Value);
        return Value;
    }

    FString NormalizeClassPath(const FString& ClassPath)
    {
        FString Normalized = ClassPath.TrimStartAndEnd();
        int32 QuoteIndex = INDEX_NONE;
        if (Normalized.FindChar(TEXT('\''), QuoteIndex) && Normalized.EndsWith(TEXT("'")))
        {
            Normalized = Normalized.Mid(QuoteIndex + 1, Normalized.Len() - QuoteIndex - 2);
        }
        Normalized.RemoveFromStart(TEXT("Class'"));
        Normalized.RemoveFromStart(TEXT("BlueprintGeneratedClass'"));
        Normalized.RemoveFromStart(TEXT("WidgetBlueprintGeneratedClass'"));
        Normalized.RemoveFromEnd(TEXT("'"));
        return Normalized;
    }

    FString BuildGeneratedClassPathFromObjectPath(const FString& ObjectPath)
    {
        const int32 DotIndex = ObjectPath.Find(TEXT("."));
        if (DotIndex == INDEX_NONE)
        {
            return FString();
        }

        const FString PackagePath = ObjectPath.Left(DotIndex);
        const FString AssetName = ObjectPath.Mid(DotIndex + 1);
        return FString::Printf(TEXT("%s.%s_C"), *PackagePath, *AssetName);
    }

    void PopulateLoadedClassDiagnostic(const FString& ClassPath, FUEHperAssetDiagnosticResult& Result)
    {
        if (ClassPath.IsEmpty())
        {
            return;
        }

        UClass* LoadedClass = LoadObject<UClass>(nullptr, *ClassPath);
        if (!LoadedClass)
        {
            Result.ClassLoadErrorMessage = FString::Printf(TEXT("Failed to load generated class: %s"), *ClassPath);
            return;
        }

        Result.bClassLoadSucceeded = true;
        Result.LoadedClassPath = LoadedClass->GetPathName();
        Result.bIsUserWidgetClass = LoadedClass->IsChildOf(UUserWidget::StaticClass());
        Result.bGeneratedClassIsDataAsset = LoadedClass->IsChildOf(UDataAsset::StaticClass());
        Result.bGeneratedClassIsPrimaryDataAsset = LoadedClass->IsChildOf(UPrimaryDataAsset::StaticClass());
        Result.bGeneratedClassIsAnimInstance = LoadedClass->IsChildOf(UAnimInstance::StaticClass());
    }

    void PopulateLoadedObjectDiagnostic(const FString& ObjectPath, FUEHperAssetDiagnosticResult& Result)
    {
        if (ObjectPath.IsEmpty() || ObjectPath.StartsWith(TEXT("/Script/")) || Result.AssetClassPath.Contains(TEXT("World")))
        {
            return;
        }

        UObject* LoadedObject = LoadObject<UObject>(nullptr, *ObjectPath);
        if (!LoadedObject)
        {
            Result.ObjectLoadErrorMessage = FString::Printf(TEXT("Failed to load asset object: %s"), *ObjectPath);
            return;
        }

        Result.bObjectLoadSucceeded = true;
        Result.LoadedObjectClassPath = LoadedObject->GetClass()->GetPathName();
        Result.bIsDataAsset = LoadedObject->IsA<UDataAsset>();
        Result.bIsPrimaryDataAsset = LoadedObject->IsA<UPrimaryDataAsset>();
        Result.bIsAnimBlueprint = LoadedObject->IsA<UAnimBlueprint>();

        if (const UBlueprint* Blueprint = Cast<UBlueprint>(LoadedObject))
        {
            if (Blueprint->ParentClass)
            {
                Result.BlueprintParentClassPath = Blueprint->ParentClass->GetPathName();
            }
        }
    }
}

bool UUEHperAssetDiagnosticsLibrary::GetAssetDiagnostic(const FString& AssetPath, FUEHperAssetDiagnosticResult& Result)
{
    Result = FUEHperAssetDiagnosticResult();
    Result.InputPath = AssetPath;

    if (AssetPath.IsEmpty())
    {
        Result.ErrorMessage = TEXT("AssetPath is empty.");
        return false;
    }

    const FString ObjectPath = NormalizeObjectPath(AssetPath);
    Result.ObjectPath = ObjectPath;

    if (ObjectPath.StartsWith(TEXT("/Script/")))
    {
        Result.bExists = true;
        Result.PackagePath = ObjectPath;
        Result.AssetName = FPackageName::GetShortName(ObjectPath);
        Result.AssetClassPath = TEXT("/Script");
        Result.GeneratedClassPath = ObjectPath;
        PopulateLoadedClassDiagnostic(Result.GeneratedClassPath, Result);
        return true;
    }

    if (!ObjectPath.StartsWith(TEXT("/Game/")))
    {
        Result.ErrorMessage = FString::Printf(TEXT("Asset path is not under /Game or /Script: %s"), *AssetPath);
        return false;
    }

    const int32 DotIndex = ObjectPath.Find(TEXT("."));
    Result.PackagePath = DotIndex == INDEX_NONE ? ObjectPath : ObjectPath.Left(DotIndex);
    Result.AssetName = DotIndex == INDEX_NONE ? FPackageName::GetShortName(Result.PackagePath) : ObjectPath.Mid(DotIndex + 1);
    Result.bIsGameAsset = true;

    FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
    IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();
    const FAssetData AssetData = AssetRegistry.GetAssetByObjectPath(FSoftObjectPath(ObjectPath));

    if (!AssetData.IsValid())
    {
        Result.ErrorMessage = FString::Printf(TEXT("AssetRegistry did not find asset: %s"), *ObjectPath);
        return false;
    }

    Result.bExists = true;
    Result.AssetClassPath = AssetData.AssetClassPath.ToString();
    Result.bIsBlueprintAsset = Result.AssetClassPath.Contains(TEXT("Blueprint"));
    Result.bIsWidgetBlueprint = Result.AssetClassPath.Contains(TEXT("WidgetBlueprint"));
    Result.NativeParentClassPath = GetAssetDataTagValue(AssetData, TEXT("NativeParentClass"));
    Result.GeneratedClassPath = NormalizeClassPath(GetAssetDataTagValue(AssetData, TEXT("GeneratedClass")));
    if (Result.GeneratedClassPath.IsEmpty() && Result.bIsBlueprintAsset)
    {
        Result.GeneratedClassPath = BuildGeneratedClassPathFromObjectPath(ObjectPath);
    }
    PopulateLoadedClassDiagnostic(Result.GeneratedClassPath, Result);
    PopulateLoadedObjectDiagnostic(ObjectPath, Result);

    return true;
}

FString UUEHperAssetDiagnosticsLibrary::NormalizeObjectPath(const FString& AssetPath)
{
    FString Normalized = AssetPath.TrimStartAndEnd();
    Normalized.RemoveFromStart(TEXT("Class'"));
    Normalized.RemoveFromStart(TEXT("BlueprintGeneratedClass'"));
    Normalized.RemoveFromStart(TEXT("WidgetBlueprintGeneratedClass'"));
    Normalized.RemoveFromEnd(TEXT("'"));

    if (Normalized.EndsWith(TEXT("_C")))
    {
        Normalized.LeftChopInline(2);
    }

    if (Normalized.StartsWith(TEXT("/Game/")) && !Normalized.Contains(TEXT(".")))
    {
        Normalized = BuildObjectPathFromPackagePath(Normalized);
    }

    return Normalized;
}

FString UUEHperAssetDiagnosticsLibrary::BuildObjectPathFromPackagePath(const FString& PackagePath)
{
    return FString::Printf(TEXT("%s.%s"), *PackagePath, *FPackageName::GetShortName(PackagePath));
}