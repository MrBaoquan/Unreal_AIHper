// Copyright Epic Games, Inc. All Rights Reserved.

#include "UEHper.h"

#include "AssetRegistry/AssetRegistryModule.h"
#if WITH_EDITOR
#include "AssetToolsModule.h"
#include "Animation/WidgetAnimation.h"
#include "Blueprint/WidgetTree.h"
#include "Components/CanvasPanel.h"
#include "Components/TextBlock.h"
#include "ContentBrowserModule.h"
#include "Factories/WorldFactory.h"
#include "IContentBrowserSingleton.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Engine/LevelStreamingDynamic.h"
#include "MovieScene.h"
#include "UObject/SavePackage.h"
#include "WidgetBlueprint.h"
#include "WidgetBlueprintFactory.h"
#endif
#include "Engine/Engine.h"
#include "HAL/IConsoleManager.h"
#include "HAL/FileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/CommandLine.h"
#include "Misc/PackageName.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UEHperAssetDiagnosticsLibrary.h"

#define LOCTEXT_NAMESPACE "FUEHperModule"

DEFINE_LOG_CATEGORY_STATIC(LogUEHper, Log, All);

#if WITH_EDITOR
namespace
{
	FString GetJsonStringField(const TSharedPtr<FJsonObject>& Object, const TCHAR* FieldName)
	{
		if (!Object.IsValid())
		{
			return FString();
		}

		FString Value;
		Object->TryGetStringField(FieldName, Value);
		return Value;
	}

	void SetJsonStringField(const TSharedPtr<FJsonObject>& Object, const TCHAR* FieldName, const FString& Value)
	{
		Object->SetStringField(FieldName, Value);
	}

	void SetJsonBoolField(const TSharedPtr<FJsonObject>& Object, const TCHAR* FieldName, bool bValue)
	{
		Object->SetBoolField(FieldName, bValue);
	}

	TSharedRef<FJsonObject> BuildDiagnosticJson(const TSharedPtr<FJsonObject>& RequestObject, const FUEHperAssetDiagnosticResult& DiagnosticResult, bool bSuccess)
	{
		TSharedRef<FJsonObject> Item = MakeShared<FJsonObject>();
		SetJsonStringField(Item, TEXT("source"), GetJsonStringField(RequestObject, TEXT("source")));
		SetJsonStringField(Item, TEXT("key"), GetJsonStringField(RequestObject, TEXT("key")));
		SetJsonStringField(Item, TEXT("path"), GetJsonStringField(RequestObject, TEXT("path")));
		SetJsonStringField(Item, TEXT("expectedType"), GetJsonStringField(RequestObject, TEXT("expectedType")));
		SetJsonBoolField(Item, TEXT("success"), bSuccess);
		SetJsonStringField(Item, TEXT("inputPath"), DiagnosticResult.InputPath);
		SetJsonStringField(Item, TEXT("objectPath"), DiagnosticResult.ObjectPath);
		SetJsonStringField(Item, TEXT("packagePath"), DiagnosticResult.PackagePath);
		SetJsonStringField(Item, TEXT("assetName"), DiagnosticResult.AssetName);
		SetJsonStringField(Item, TEXT("assetClassPath"), DiagnosticResult.AssetClassPath);
		SetJsonStringField(Item, TEXT("nativeParentClassPath"), DiagnosticResult.NativeParentClassPath);
		SetJsonStringField(Item, TEXT("generatedClassPath"), DiagnosticResult.GeneratedClassPath);
		SetJsonStringField(Item, TEXT("loadedClassPath"), DiagnosticResult.LoadedClassPath);
		SetJsonStringField(Item, TEXT("loadedObjectClassPath"), DiagnosticResult.LoadedObjectClassPath);
		SetJsonStringField(Item, TEXT("blueprintParentClassPath"), DiagnosticResult.BlueprintParentClassPath);
		SetJsonBoolField(Item, TEXT("exists"), DiagnosticResult.bExists);
		SetJsonBoolField(Item, TEXT("isGameAsset"), DiagnosticResult.bIsGameAsset);
		SetJsonBoolField(Item, TEXT("isBlueprintAsset"), DiagnosticResult.bIsBlueprintAsset);
		SetJsonBoolField(Item, TEXT("isWidgetBlueprint"), DiagnosticResult.bIsWidgetBlueprint);
		SetJsonBoolField(Item, TEXT("classLoadSucceeded"), DiagnosticResult.bClassLoadSucceeded);
		SetJsonBoolField(Item, TEXT("objectLoadSucceeded"), DiagnosticResult.bObjectLoadSucceeded);
		SetJsonBoolField(Item, TEXT("isUserWidgetClass"), DiagnosticResult.bIsUserWidgetClass);
		SetJsonBoolField(Item, TEXT("generatedClassIsDataAsset"), DiagnosticResult.bGeneratedClassIsDataAsset);
		SetJsonBoolField(Item, TEXT("generatedClassIsPrimaryDataAsset"), DiagnosticResult.bGeneratedClassIsPrimaryDataAsset);
		SetJsonBoolField(Item, TEXT("generatedClassIsAnimInstance"), DiagnosticResult.bGeneratedClassIsAnimInstance);
		SetJsonBoolField(Item, TEXT("isDataAsset"), DiagnosticResult.bIsDataAsset);
		SetJsonBoolField(Item, TEXT("isPrimaryDataAsset"), DiagnosticResult.bIsPrimaryDataAsset);
		SetJsonBoolField(Item, TEXT("isAnimBlueprint"), DiagnosticResult.bIsAnimBlueprint);
		SetJsonStringField(Item, TEXT("classLoadErrorMessage"), DiagnosticResult.ClassLoadErrorMessage);
		SetJsonStringField(Item, TEXT("objectLoadErrorMessage"), DiagnosticResult.ObjectLoadErrorMessage);
		SetJsonStringField(Item, TEXT("errorMessage"), DiagnosticResult.ErrorMessage);
		return Item;
	}

	bool WriteAssetDiagnosticsResult(const FString& OutputPath, const TSharedRef<FJsonObject>& ResultObject)
	{
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(OutputPath), true);

		FString OutputJson;
		TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputJson);
		if (!FJsonSerializer::Serialize(ResultObject, Writer))
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to serialize asset diagnostics JSON."));
			return false;
		}

		if (!FFileHelper::SaveStringToFile(OutputJson, *OutputPath))
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to write asset diagnostics output: %s"), *OutputPath);
			return false;
		}

		return true;
	}

	FString GetDefaultSelectedAssetsOutputPath()
	{
		return FPaths::Combine(FPaths::ProjectIntermediateDir(), TEXT("UEHper"), TEXT("SelectedAssets"), TEXT("selected-assets.json"));
	}

	FString GetDefaultCookSmokeMapPackagePath()
	{
		return TEXT("/Game/UEHper/CookSmoke");
	}

	FString GetDefaultUIValidationWidgetPackagePath()
	{
		return TEXT("/Game/UEHper/UI/WBP_UIValidation");
	}

	FString GetDefaultStreamingValidationPersistentMapPackagePath()
	{
		return TEXT("/Game/UEHper/Streaming/Persistent");
	}

	FString GetDefaultStreamingValidationSubLevelPackagePath()
	{
		return TEXT("/Game/UEHper/Streaming/Sub_A");
	}

	void SetValidationAnimationPlaybackRange(UMovieScene* MovieScene)
	{
		if (MovieScene)
		{
			MovieScene->SetPlaybackRange(0, 30000);
		}
	}

	FString NormalizeMapPackagePath(FString MapPackagePath)
	{
		MapPackagePath.TrimStartAndEndInline();
		MapPackagePath.RemoveFromStart(TEXT("\""));
		MapPackagePath.RemoveFromEnd(TEXT("\""));

		const int32 DotIndex = MapPackagePath.Find(TEXT("."));
		if (DotIndex != INDEX_NONE)
		{
			MapPackagePath = MapPackagePath.Left(DotIndex);
		}

		return MapPackagePath.IsEmpty() ? GetDefaultCookSmokeMapPackagePath() : MapPackagePath;
	}

	FString NormalizeAssetPackagePath(FString PackagePath, const FString& DefaultPackagePath)
	{
		PackagePath.TrimStartAndEndInline();
		PackagePath.RemoveFromStart(TEXT("\""));
		PackagePath.RemoveFromEnd(TEXT("\""));

		const int32 DotIndex = PackagePath.Find(TEXT("."));
		if (DotIndex != INDEX_NONE)
		{
			PackagePath = PackagePath.Left(DotIndex);
		}

		return PackagePath.IsEmpty() ? DefaultPackagePath : PackagePath;
	}

	bool EnsureCookSmokeMapAsset(const FString& InputMapPackagePath)
	{
		const FString MapPackagePath = NormalizeMapPackagePath(InputMapPackagePath);
		if (!FPackageName::IsValidLongPackageName(MapPackagePath, true))
		{
			UE_LOG(LogUEHper, Error, TEXT("Invalid CookSmoke map package path: %s"), *MapPackagePath);
			return false;
		}

		FString ExistingPackageFileName;
		if (FPackageName::DoesPackageExist(MapPackagePath, &ExistingPackageFileName))
		{
			UE_LOG(LogUEHper, Display, TEXT("CookSmoke map already exists: %s"), *MapPackagePath);
			return true;
		}

		const FString PackagePath = FPackageName::GetLongPackagePath(MapPackagePath);
		const FString AssetName = FPackageName::GetShortName(MapPackagePath);
		FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));
		UWorldFactory* WorldFactory = NewObject<UWorldFactory>();
		UObject* CreatedAsset = AssetToolsModule.Get().CreateAsset(AssetName, PackagePath, UWorld::StaticClass(), WorldFactory);
		if (!CreatedAsset)
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to create CookSmoke map asset: %s"), *MapPackagePath);
			return false;
		}

		UPackage* Package = CreatedAsset->GetOutermost();
		Package->MarkPackageDirty();
		FAssetRegistryModule::AssetCreated(CreatedAsset);

		const FString PackageFileName = FPackageName::LongPackageNameToFilename(MapPackagePath, FPackageName::GetMapPackageExtension());
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(PackageFileName), true);

		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_None;
		const bool bSaved = UPackage::SavePackage(Package, CreatedAsset, *PackageFileName, SaveArgs);
		if (bSaved)
		{
			UE_LOG(LogUEHper, Display, TEXT("CookSmoke map save succeeded: %s -> %s"), *MapPackagePath, *PackageFileName);
		}
		else
		{
			UE_LOG(LogUEHper, Error, TEXT("CookSmoke map save failed: %s -> %s"), *MapPackagePath, *PackageFileName);
		}
		return bSaved;
	}

	bool SaveMapPackage(UWorld* World, const FString& MapPackagePath)
	{
		if (!World)
		{
			return false;
		}

		UPackage* Package = World->GetOutermost();
		Package->MarkPackageDirty();
		const FString PackageFileName = FPackageName::LongPackageNameToFilename(MapPackagePath, FPackageName::GetMapPackageExtension());
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(PackageFileName), true);

		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_None;
		return UPackage::SavePackage(Package, World, *PackageFileName, SaveArgs);
	}

	bool EnsureStreamingValidationMapsAsset(const FString& InputPersistentMapPackagePath, const FString& InputSubLevelPackagePath)
	{
		const FString PersistentMapPackagePath = NormalizeMapPackagePath(InputPersistentMapPackagePath.IsEmpty() ? GetDefaultStreamingValidationPersistentMapPackagePath() : InputPersistentMapPackagePath);
		const FString SubLevelPackagePath = NormalizeMapPackagePath(InputSubLevelPackagePath.IsEmpty() ? GetDefaultStreamingValidationSubLevelPackagePath() : InputSubLevelPackagePath);
		if (!EnsureCookSmokeMapAsset(PersistentMapPackagePath) || !EnsureCookSmokeMapAsset(SubLevelPackagePath))
		{
			return false;
		}

		UWorld* PersistentWorld = LoadObject<UWorld>(nullptr, *PersistentMapPackagePath);
		if (!PersistentWorld)
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to load streaming validation persistent map: %s"), *PersistentMapPackagePath);
			return false;
		}

		for (ULevelStreaming* ExistingStreamingLevel : PersistentWorld->GetStreamingLevels())
		{
			if (ExistingStreamingLevel && ExistingStreamingLevel->GetWorldAssetPackageFName() == FName(*SubLevelPackagePath))
			{
				UE_LOG(LogUEHper, Display, TEXT("Streaming validation map already references sublevel: %s -> %s"), *PersistentMapPackagePath, *SubLevelPackagePath);
				return true;
			}
		}

		ULevelStreamingDynamic* StreamingLevel = NewObject<ULevelStreamingDynamic>(PersistentWorld, ULevelStreamingDynamic::StaticClass(), TEXT("UEHperStreamingValidation_Sub_A"), RF_Public | RF_Transactional);
		if (!StreamingLevel)
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to create streaming level entry: %s"), *SubLevelPackagePath);
			return false;
		}

		StreamingLevel->SetWorldAssetByPackageName(FName(*SubLevelPackagePath));
		StreamingLevel->bInitiallyLoaded = false;
		StreamingLevel->bInitiallyVisible = false;
		StreamingLevel->SetShouldBeLoaded(false);
		StreamingLevel->SetShouldBeVisible(false);
		PersistentWorld->AddStreamingLevel(StreamingLevel);

		const bool bSaved = SaveMapPackage(PersistentWorld, PersistentMapPackagePath);
		if (bSaved)
		{
			UE_LOG(LogUEHper, Display, TEXT("Streaming validation maps ready: %s -> %s"), *PersistentMapPackagePath, *SubLevelPackagePath);
		}
		else
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to save streaming validation persistent map: %s"), *PersistentMapPackagePath);
		}
		return bSaved;
	}

	bool AddValidationWidgetTree(UWidgetBlueprint* WidgetBlueprint)
	{
		if (!WidgetBlueprint || !WidgetBlueprint->WidgetTree || WidgetBlueprint->WidgetTree->RootWidget)
		{
			return false;
		}

		UCanvasPanel* Root = WidgetBlueprint->WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("Root"));
		UTextBlock* Text = WidgetBlueprint->WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("ValidationText"));
		Text->SetText(FText::FromString(TEXT("UEHper UI Validation")));
		Text->SetColorAndOpacity(FSlateColor(FLinearColor::White));
		Root->AddChild(Text);
		WidgetBlueprint->WidgetTree->RootWidget = Root;
		return true;
	}

	bool EnsureValidationWidgetAnimation(UWidgetBlueprint* WidgetBlueprint)
	{
		if (!WidgetBlueprint)
		{
			return false;
		}

		for (UWidgetAnimation* ExistingAnimation : WidgetBlueprint->Animations)
		{
			if (ExistingAnimation && ExistingAnimation->GetFName() == TEXT("Intro"))
			{
				bool bChanged = false;
				if (!ExistingAnimation->MovieScene)
				{
					ExistingAnimation->MovieScene = NewObject<UMovieScene>(ExistingAnimation, UMovieScene::StaticClass(), TEXT("IntroMovieScene"), RF_Public | RF_Transactional);
					bChanged = true;
				}

				if (ExistingAnimation->MovieScene && ExistingAnimation->GetEndTime() - ExistingAnimation->GetStartTime() < 0.1f)
				{
					SetValidationAnimationPlaybackRange(ExistingAnimation->MovieScene);
					bChanged = true;
				}

				return bChanged;
			}
		}

		UWidgetAnimation* Animation = NewObject<UWidgetAnimation>(WidgetBlueprint, UWidgetAnimation::StaticClass(), TEXT("Intro"), RF_Public | RF_Transactional);
		Animation->MovieScene = NewObject<UMovieScene>(Animation, UMovieScene::StaticClass(), TEXT("IntroMovieScene"), RF_Public | RF_Transactional);
		SetValidationAnimationPlaybackRange(Animation->MovieScene);
		Animation->SetDisplayLabel(TEXT("Intro"));
		WidgetBlueprint->Animations.Add(Animation);
		return true;
	}

	bool EnsureUIValidationWidgetAsset(const FString& InputWidgetPackagePath)
	{
		const FString WidgetPackagePath = NormalizeAssetPackagePath(InputWidgetPackagePath, GetDefaultUIValidationWidgetPackagePath());
		if (!FPackageName::IsValidLongPackageName(WidgetPackagePath, true))
		{
			UE_LOG(LogUEHper, Error, TEXT("Invalid UI validation widget package path: %s"), *WidgetPackagePath);
			return false;
		}

		FString ExistingPackageFileName;
		if (FPackageName::DoesPackageExist(WidgetPackagePath, &ExistingPackageFileName))
		{
			const FString AssetName = FPackageName::GetShortName(WidgetPackagePath);
			const FString WidgetObjectPath = FString::Printf(TEXT("%s.%s"), *WidgetPackagePath, *AssetName);
			UWidgetBlueprint* ExistingWidgetBlueprint = LoadObject<UWidgetBlueprint>(nullptr, *WidgetObjectPath);
			if (!ExistingWidgetBlueprint)
			{
				UE_LOG(LogUEHper, Error, TEXT("Failed to load existing UI validation Widget Blueprint: %s"), *WidgetObjectPath);
				return false;
			}

			const bool bChangedTree = AddValidationWidgetTree(ExistingWidgetBlueprint);
			const bool bChangedAnimation = EnsureValidationWidgetAnimation(ExistingWidgetBlueprint);
			if (bChangedTree || bChangedAnimation)
			{
				FKismetEditorUtilities::CompileBlueprint(ExistingWidgetBlueprint);
				UPackage* Package = ExistingWidgetBlueprint->GetOutermost();
				Package->MarkPackageDirty();

				FSavePackageArgs SaveArgs;
				SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
				SaveArgs.SaveFlags = SAVE_None;
				const bool bSaved = UPackage::SavePackage(Package, ExistingWidgetBlueprint, *ExistingPackageFileName, SaveArgs);
				UE_LOG(LogUEHper, Display, TEXT("UI validation widget update %s: %s -> %s"), bSaved ? TEXT("succeeded") : TEXT("failed"), *WidgetPackagePath, *ExistingPackageFileName);
				return bSaved;
			}

			UE_LOG(LogUEHper, Display, TEXT("UI validation widget already exists: %s"), *WidgetPackagePath);
			return true;
		}

		const FString PackagePath = FPackageName::GetLongPackagePath(WidgetPackagePath);
		const FString AssetName = FPackageName::GetShortName(WidgetPackagePath);
		FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>(TEXT("AssetTools"));
		UWidgetBlueprintFactory* WidgetFactory = NewObject<UWidgetBlueprintFactory>();
		WidgetFactory->ParentClass = UUserWidget::StaticClass();
		UObject* CreatedAsset = AssetToolsModule.Get().CreateAsset(AssetName, PackagePath, UWidgetBlueprint::StaticClass(), WidgetFactory);
		UWidgetBlueprint* WidgetBlueprint = Cast<UWidgetBlueprint>(CreatedAsset);
		if (!WidgetBlueprint)
		{
			UE_LOG(LogUEHper, Error, TEXT("Failed to create UI validation Widget Blueprint: %s"), *WidgetPackagePath);
			return false;
		}

		AddValidationWidgetTree(WidgetBlueprint);
		EnsureValidationWidgetAnimation(WidgetBlueprint);
		FKismetEditorUtilities::CompileBlueprint(WidgetBlueprint);

		UPackage* Package = WidgetBlueprint->GetOutermost();
		Package->MarkPackageDirty();
		FAssetRegistryModule::AssetCreated(WidgetBlueprint);

		const FString PackageFileName = FPackageName::LongPackageNameToFilename(WidgetPackagePath, FPackageName::GetAssetPackageExtension());
		IFileManager::Get().MakeDirectory(*FPaths::GetPath(PackageFileName), true);

		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_None;
		const bool bSaved = UPackage::SavePackage(Package, WidgetBlueprint, *PackageFileName, SaveArgs);
		if (bSaved)
		{
			UE_LOG(LogUEHper, Display, TEXT("UI validation widget save succeeded: %s -> %s"), *WidgetPackagePath, *PackageFileName);
		}
		else
		{
			UE_LOG(LogUEHper, Error, TEXT("UI validation widget save failed: %s -> %s"), *WidgetPackagePath, *PackageFileName);
		}
		return bSaved;
	}

	FString GetSelectedAssetSuggestedKind(const FAssetData& AssetData)
	{
		const FString AssetClassPath = AssetData.AssetClassPath.ToString();
		if (AssetClassPath.Contains(TEXT("World")))
		{
			return TEXT("scene");
		}
		if (AssetClassPath.Contains(TEXT("WidgetBlueprint")))
		{
			return TEXT("widget");
		}
		return TEXT("resource");
	}

	TSharedRef<FJsonObject> BuildSelectedAssetJson(const FAssetData& AssetData)
	{
		TSharedRef<FJsonObject> Item = MakeShared<FJsonObject>();
		SetJsonStringField(Item, TEXT("objectPath"), AssetData.GetObjectPathString());
		SetJsonStringField(Item, TEXT("packagePath"), AssetData.PackageName.ToString());
		SetJsonStringField(Item, TEXT("packageName"), AssetData.PackageName.ToString());
		SetJsonStringField(Item, TEXT("assetName"), AssetData.AssetName.ToString());
		SetJsonStringField(Item, TEXT("assetClassPath"), AssetData.AssetClassPath.ToString());
		SetJsonStringField(Item, TEXT("suggestedKind"), GetSelectedAssetSuggestedKind(AssetData));
		return Item;
	}

	bool RunAssetDiagnosticsRequest(const FString& RequestPath, const FString& OutputPath)
	{
		FString RequestJson;
		TSharedRef<FJsonObject> ResultObject = MakeShared<FJsonObject>();
		TArray<TSharedPtr<FJsonValue>> ResultItems;

		if (!FFileHelper::LoadFileToString(RequestJson, *RequestPath))
		{
			ResultObject->SetBoolField(TEXT("success"), false);
			ResultObject->SetStringField(TEXT("errorMessage"), FString::Printf(TEXT("Failed to read request file: %s"), *RequestPath));
			ResultObject->SetArrayField(TEXT("diagnostics"), ResultItems);
			WriteAssetDiagnosticsResult(OutputPath, ResultObject);
			return false;
		}

		TSharedPtr<FJsonObject> RequestRoot;
		TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(RequestJson);
		if (!FJsonSerializer::Deserialize(Reader, RequestRoot) || !RequestRoot.IsValid())
		{
			ResultObject->SetBoolField(TEXT("success"), false);
			ResultObject->SetStringField(TEXT("errorMessage"), TEXT("Failed to parse request JSON."));
			ResultObject->SetArrayField(TEXT("diagnostics"), ResultItems);
			WriteAssetDiagnosticsResult(OutputPath, ResultObject);
			return false;
		}

		const TArray<TSharedPtr<FJsonValue>>* Requests = nullptr;
		if (!RequestRoot->TryGetArrayField(TEXT("requests"), Requests))
		{
			ResultObject->SetBoolField(TEXT("success"), false);
			ResultObject->SetStringField(TEXT("errorMessage"), TEXT("Request JSON must contain a requests array."));
			ResultObject->SetArrayField(TEXT("diagnostics"), ResultItems);
			WriteAssetDiagnosticsResult(OutputPath, ResultObject);
			return false;
		}

		FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
		AssetRegistryModule.Get().SearchAllAssets(true);

		int32 FailureCount = 0;
		for (const TSharedPtr<FJsonValue>& RequestValue : *Requests)
		{
			TSharedPtr<FJsonObject> RequestObject = RequestValue.IsValid() ? RequestValue->AsObject() : nullptr;
			const FString AssetPath = GetJsonStringField(RequestObject, TEXT("path"));

			FUEHperAssetDiagnosticResult DiagnosticResult;
			const bool bSuccess = UUEHperAssetDiagnosticsLibrary::GetAssetDiagnostic(AssetPath, DiagnosticResult);
			if (!bSuccess)
			{
				FailureCount++;
			}

			ResultItems.Add(MakeShared<FJsonValueObject>(BuildDiagnosticJson(RequestObject, DiagnosticResult, bSuccess)));
		}

		ResultObject->SetBoolField(TEXT("success"), FailureCount == 0);
		ResultObject->SetNumberField(TEXT("requestCount"), Requests->Num());
		ResultObject->SetNumberField(TEXT("failureCount"), FailureCount);
		ResultObject->SetArrayField(TEXT("diagnostics"), ResultItems);
		return WriteAssetDiagnosticsResult(OutputPath, ResultObject);
	}
}
#endif

void FUEHperModule::StartupModule()
{
	// This code will execute after your module is loaded into memory; the exact timing is specified in the .uplugin file per-module

#if WITH_EDITOR
	ExportSelectedAssetsCommand = IConsoleManager::Get().RegisterConsoleCommand(
		TEXT("UEHper.ExportSelectedAssets"),
		TEXT("Export Content Browser selected assets to JSON. Usage: UEHper.ExportSelectedAssets [OutputPath]"),
		FConsoleCommandWithArgsDelegate::CreateRaw(this, &FUEHperModule::ExportSelectedAssets),
		ECVF_Default);

	EnsureCookSmokeMapCommand = IConsoleManager::Get().RegisterConsoleCommand(
		TEXT("UEHper.EnsureCookSmokeMap"),
		TEXT("Create the dedicated project CookSmoke map if it is missing. Usage: UEHper.EnsureCookSmokeMap [/Game/UEHper/CookSmoke]"),
		FConsoleCommandWithArgsDelegate::CreateRaw(this, &FUEHperModule::EnsureCookSmokeMap),
		ECVF_Default);

	EnsureStreamingValidationMapsCommand = IConsoleManager::Get().RegisterConsoleCommand(
		TEXT("UEHper.EnsureStreamingValidationMaps"),
		TEXT("Create persistent and sublevel maps for UEHper streaming validation. Usage: UEHper.EnsureStreamingValidationMaps [/Game/UEHper/Streaming/Persistent] [/Game/UEHper/Streaming/Sub_A]"),
		FConsoleCommandWithArgsDelegate::CreateRaw(this, &FUEHperModule::EnsureStreamingValidationMaps),
		ECVF_Default);

	EnsureUIValidationWidgetCommand = IConsoleManager::Get().RegisterConsoleCommand(
		TEXT("UEHper.EnsureUIValidationWidget"),
		TEXT("Create the project UI validation Widget Blueprint if it is missing. Usage: UEHper.EnsureUIValidationWidget [/Game/UEHper/UI/WBP_UIValidation]"),
		FConsoleCommandWithArgsDelegate::CreateRaw(this, &FUEHperModule::EnsureUIValidationWidget),
		ECVF_Default);

	FString PuertsGenMode;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperRunPuertsGen="), PuertsGenMode))
	{
		if (PuertsGenMode.IsEmpty())
		{
			PuertsGenMode = TEXT("FULL");
		}

		const bool bRequestExitAfterGenerate = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterPuertsGen"));
		SchedulePuertsGen(PuertsGenMode, bRequestExitAfterGenerate);
	}

	FString AssetDiagnosticsRequestPath;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperRunAssetDiagnostics="), AssetDiagnosticsRequestPath))
	{
		FString AssetDiagnosticsOutputPath;
		FParse::Value(FCommandLine::Get(), TEXT("UEHperAssetDiagnosticsOutput="), AssetDiagnosticsOutputPath);
		if (AssetDiagnosticsOutputPath.IsEmpty())
		{
			AssetDiagnosticsOutputPath = FPaths::SetExtension(AssetDiagnosticsRequestPath, TEXT("result.json"));
		}

		const bool bRequestExitAfterDiagnostics = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterAssetDiagnostics"));
		ScheduleAssetDiagnostics(AssetDiagnosticsRequestPath, AssetDiagnosticsOutputPath, bRequestExitAfterDiagnostics);
	}

	FString SelectedAssetsOutputPath;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperExportSelectedAssets="), SelectedAssetsOutputPath))
	{
		const bool bRequestExitAfterExport = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterSelectedAssetsExport"));
		ScheduleSelectedAssetsExport(SelectedAssetsOutputPath, bRequestExitAfterExport);
	}

	FString CookSmokeMapPackagePath;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperEnsureCookSmokeMap="), CookSmokeMapPackagePath))
	{
		const bool bRequestExitAfterEnsure = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterCookSmokeMapEnsure"));
		ScheduleEnsureCookSmokeMap(CookSmokeMapPackagePath, bRequestExitAfterEnsure);
	}

	FString StreamingValidationPersistentMapPackagePath;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperEnsureStreamingValidationMaps="), StreamingValidationPersistentMapPackagePath))
	{
		FString StreamingValidationSubLevelPackagePath;
		FParse::Value(FCommandLine::Get(), TEXT("UEHperStreamingValidationSubLevel="), StreamingValidationSubLevelPackagePath);
		const bool bRequestExitAfterEnsure = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterStreamingValidationMapsEnsure"));
		ScheduleEnsureStreamingValidationMaps(StreamingValidationPersistentMapPackagePath, StreamingValidationSubLevelPackagePath, bRequestExitAfterEnsure);
	}

	FString UIValidationWidgetPackagePath;
	if (FParse::Value(FCommandLine::Get(), TEXT("UEHperEnsureUIValidationWidget="), UIValidationWidgetPackagePath))
	{
		const bool bRequestExitAfterEnsure = !FParse::Param(FCommandLine::Get(), TEXT("UEHperNoExitAfterUIValidationWidgetEnsure"));
		ScheduleEnsureUIValidationWidget(UIValidationWidgetPackagePath, bRequestExitAfterEnsure);
	}
#endif
}

void FUEHperModule::ShutdownModule()
{
	// This function may be called during shutdown to clean up your module.  For modules that support dynamic reloading,
	// we call this function before unloading the module.

#if WITH_EDITOR
	if (PuertsGenTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(PuertsGenTickerHandle);
		PuertsGenTickerHandle.Reset();
	}
	if (AssetDiagnosticsTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(AssetDiagnosticsTickerHandle);
		AssetDiagnosticsTickerHandle.Reset();
	}
	if (SelectedAssetsExportTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(SelectedAssetsExportTickerHandle);
		SelectedAssetsExportTickerHandle.Reset();
	}
	if (EnsureCookSmokeMapTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(EnsureCookSmokeMapTickerHandle);
		EnsureCookSmokeMapTickerHandle.Reset();
	}
	if (EnsureStreamingValidationMapsTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(EnsureStreamingValidationMapsTickerHandle);
		EnsureStreamingValidationMapsTickerHandle.Reset();
	}
	if (EnsureUIValidationWidgetTickerHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(EnsureUIValidationWidgetTickerHandle);
		EnsureUIValidationWidgetTickerHandle.Reset();
	}
	if (ExportSelectedAssetsCommand)
	{
		IConsoleManager::Get().UnregisterConsoleObject(ExportSelectedAssetsCommand);
		ExportSelectedAssetsCommand = nullptr;
	}
	if (EnsureCookSmokeMapCommand)
	{
		IConsoleManager::Get().UnregisterConsoleObject(EnsureCookSmokeMapCommand);
		EnsureCookSmokeMapCommand = nullptr;
	}
	if (EnsureStreamingValidationMapsCommand)
	{
		IConsoleManager::Get().UnregisterConsoleObject(EnsureStreamingValidationMapsCommand);
		EnsureStreamingValidationMapsCommand = nullptr;
	}
	if (EnsureUIValidationWidgetCommand)
	{
		IConsoleManager::Get().UnregisterConsoleObject(EnsureUIValidationWidgetCommand);
		EnsureUIValidationWidgetCommand = nullptr;
	}
#endif
}

#if WITH_EDITOR
void FUEHperModule::ExportSelectedAssets(const TArray<FString>& Args)
{
	const FString OutputPath = Args.Num() > 0 && !Args[0].IsEmpty() ? Args[0] : GetDefaultSelectedAssetsOutputPath();
	TArray<FAssetData> SelectedAssets;

	FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
	ContentBrowserModule.Get().GetSelectedAssets(SelectedAssets);

	TSharedRef<FJsonObject> ResultObject = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> AssetItems;
	for (const FAssetData& AssetData : SelectedAssets)
	{
		AssetItems.Add(MakeShared<FJsonValueObject>(BuildSelectedAssetJson(AssetData)));
	}

	ResultObject->SetBoolField(TEXT("success"), true);
	ResultObject->SetNumberField(TEXT("assetCount"), SelectedAssets.Num());
	ResultObject->SetArrayField(TEXT("assets"), AssetItems);

	if (WriteAssetDiagnosticsResult(OutputPath, ResultObject))
	{
		UE_LOG(LogUEHper, Display, TEXT("Exported %d selected assets to %s."), SelectedAssets.Num(), *OutputPath);
	}
	else
	{
		UE_LOG(LogUEHper, Error, TEXT("Failed to export selected assets to %s."), *OutputPath);
	}
}

void FUEHperModule::ScheduleSelectedAssetsExport(const FString& OutputPath, bool bRequestExitAfterExport)
{
	UE_LOG(LogUEHper, Display, TEXT("Scheduled selected asset export. Output=%s"), OutputPath.IsEmpty() ? TEXT("<default>") : *OutputPath);

	SelectedAssetsExportTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[this, OutputPath, bRequestExitAfterExport](float DeltaTime)
			{
				TArray<FString> Args;
				if (!OutputPath.IsEmpty())
				{
					Args.Add(OutputPath);
				}

				ExportSelectedAssets(Args);
				if (bRequestExitAfterExport)
				{
					FPlatformMisc::RequestExit(true);
				}

				SelectedAssetsExportTickerHandle.Reset();
				return false;
			}),
		0.5f);
}

void FUEHperModule::EnsureCookSmokeMap(const TArray<FString>& Args)
{
	const FString MapPackagePath = Args.Num() > 0 && !Args[0].IsEmpty() ? Args[0] : GetDefaultCookSmokeMapPackagePath();
	EnsureCookSmokeMapAsset(MapPackagePath);
}

void FUEHperModule::ScheduleEnsureCookSmokeMap(const FString& MapPackagePath, bool bRequestExitAfterEnsure)
{
	UE_LOG(LogUEHper, Display, TEXT("Scheduled CookSmoke map ensure. Map=%s"), MapPackagePath.IsEmpty() ? *GetDefaultCookSmokeMapPackagePath() : *MapPackagePath);

	EnsureCookSmokeMapTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[MapPackagePath, bRequestExitAfterEnsure](float DeltaTime)
			{
				const bool bSuccess = EnsureCookSmokeMapAsset(MapPackagePath);
				UE_LOG(LogUEHper, Display, TEXT("CookSmoke map ensure finished: %s."), bSuccess ? TEXT("true") : TEXT("false"));

				if (bRequestExitAfterEnsure)
				{
					FPlatformMisc::RequestExit(true);
				}

				return false;
			}),
		1.0f);
}

void FUEHperModule::EnsureStreamingValidationMaps(const TArray<FString>& Args)
{
	const FString PersistentMapPackagePath = Args.Num() > 0 && !Args[0].IsEmpty() ? Args[0] : GetDefaultStreamingValidationPersistentMapPackagePath();
	const FString SubLevelPackagePath = Args.Num() > 1 && !Args[1].IsEmpty() ? Args[1] : GetDefaultStreamingValidationSubLevelPackagePath();
	EnsureStreamingValidationMapsAsset(PersistentMapPackagePath, SubLevelPackagePath);
}

void FUEHperModule::ScheduleEnsureStreamingValidationMaps(const FString& PersistentMapPackagePath, const FString& SubLevelPackagePath, bool bRequestExitAfterEnsure)
{
	UE_LOG(LogUEHper, Display, TEXT("Scheduled streaming validation maps ensure. Persistent=%s SubLevel=%s"), PersistentMapPackagePath.IsEmpty() ? *GetDefaultStreamingValidationPersistentMapPackagePath() : *PersistentMapPackagePath, SubLevelPackagePath.IsEmpty() ? *GetDefaultStreamingValidationSubLevelPackagePath() : *SubLevelPackagePath);

	EnsureStreamingValidationMapsTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[PersistentMapPackagePath, SubLevelPackagePath, bRequestExitAfterEnsure](float DeltaTime)
			{
				const bool bSuccess = EnsureStreamingValidationMapsAsset(PersistentMapPackagePath, SubLevelPackagePath);
				UE_LOG(LogUEHper, Display, TEXT("Streaming validation maps ensure finished: %s."), bSuccess ? TEXT("true") : TEXT("false"));

				if (bRequestExitAfterEnsure)
				{
					FPlatformMisc::RequestExit(true);
				}

				return false;
			}),
		1.0f);
}

void FUEHperModule::EnsureUIValidationWidget(const TArray<FString>& Args)
{
	const FString WidgetPackagePath = Args.Num() > 0 && !Args[0].IsEmpty() ? Args[0] : GetDefaultUIValidationWidgetPackagePath();
	EnsureUIValidationWidgetAsset(WidgetPackagePath);
}

void FUEHperModule::ScheduleEnsureUIValidationWidget(const FString& WidgetPackagePath, bool bRequestExitAfterEnsure)
{
	UE_LOG(LogUEHper, Display, TEXT("Scheduled UI validation widget ensure. Widget=%s"), WidgetPackagePath.IsEmpty() ? *GetDefaultUIValidationWidgetPackagePath() : *WidgetPackagePath);

	EnsureUIValidationWidgetTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[WidgetPackagePath, bRequestExitAfterEnsure](float DeltaTime)
			{
				const bool bSuccess = EnsureUIValidationWidgetAsset(WidgetPackagePath);
				UE_LOG(LogUEHper, Display, TEXT("UI validation widget ensure finished: %s."), bSuccess ? TEXT("true") : TEXT("false"));

				if (bRequestExitAfterEnsure)
				{
					FPlatformMisc::RequestExit(true);
				}

				return false;
			}),
		1.0f);
}

void FUEHperModule::SchedulePuertsGen(const FString& Mode, bool bRequestExitAfterGenerate)
{
	TSharedRef<int32, ESPMode::ThreadSafe> Attempts = MakeShared<int32, ESPMode::ThreadSafe>(0);
	UE_LOG(LogUEHper, Display, TEXT("Scheduled Puerts.Gen %s from UEHper command line."), *Mode);

	PuertsGenTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[Attempts, Mode, bRequestExitAfterGenerate](float DeltaTime)
			{
				(*Attempts)++;

				if (!GEngine || !IConsoleManager::Get().FindConsoleObject(TEXT("Puerts.Gen")))
				{
					if (*Attempts >= 180)
					{
						UE_LOG(LogUEHper, Error, TEXT("Puerts.Gen was not available after waiting for editor startup."));
						if (bRequestExitAfterGenerate)
						{
							FPlatformMisc::RequestExit(false);
						}
						return false;
					}

					return true;
				}

				const FString Command = FString::Printf(TEXT("Puerts.Gen %s"), *Mode);
				UE_LOG(LogUEHper, Display, TEXT("Executing %s."), *Command);
				const bool bExecuted = GEngine->Exec(nullptr, *Command);
				UE_LOG(LogUEHper, Display, TEXT("Puerts.Gen execution result: %s."), bExecuted ? TEXT("true") : TEXT("false"));

				if (bRequestExitAfterGenerate)
				{
					FPlatformMisc::RequestExit(false);
				}

				return false;
			}),
		1.0f);
}

void FUEHperModule::ScheduleAssetDiagnostics(const FString& RequestPath, const FString& OutputPath, bool bRequestExitAfterDiagnostics)
{
	UE_LOG(LogUEHper, Display, TEXT("Scheduled UEHper asset diagnostics. Request=%s Output=%s"), *RequestPath, *OutputPath);

	AssetDiagnosticsTickerHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateLambda(
			[RequestPath, OutputPath, bRequestExitAfterDiagnostics](float DeltaTime)
			{
				const bool bSuccess = RunAssetDiagnosticsRequest(RequestPath, OutputPath);
				UE_LOG(LogUEHper, Display, TEXT("UEHper asset diagnostics finished: %s."), bSuccess ? TEXT("true") : TEXT("false"));

				if (bRequestExitAfterDiagnostics)
				{
					FPlatformMisc::RequestExit(true);
				}

				return false;
			}),
		1.0f);
}
#endif

#undef LOCTEXT_NAMESPACE
	
IMPLEMENT_MODULE(FUEHperModule, UEHper)