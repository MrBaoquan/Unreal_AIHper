// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "Containers/Ticker.h"
#include "Modules/ModuleManager.h"

class IConsoleObject;

class FUEHperModule : public IModuleInterface
{
public:

	/** IModuleInterface implementation */
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
#if WITH_EDITOR
	void SchedulePuertsGen(const FString& Mode, bool bRequestExitAfterGenerate);
	void ScheduleAssetDiagnostics(const FString& RequestPath, const FString& OutputPath, bool bRequestExitAfterDiagnostics);
	void ScheduleSelectedAssetsExport(const FString& OutputPath, bool bRequestExitAfterExport);
	void ScheduleEnsureCookSmokeMap(const FString& MapPackagePath, bool bRequestExitAfterEnsure);
	void ScheduleEnsureStreamingValidationMaps(const FString& PersistentMapPackagePath, const FString& SubLevelPackagePath, bool bRequestExitAfterEnsure);
	void ScheduleEnsureUIValidationWidget(const FString& WidgetPackagePath, bool bRequestExitAfterEnsure);
	void ExportSelectedAssets(const TArray<FString>& Args);
	void EnsureCookSmokeMap(const TArray<FString>& Args);
	void EnsureStreamingValidationMaps(const TArray<FString>& Args);
	void EnsureUIValidationWidget(const TArray<FString>& Args);

	FTSTicker::FDelegateHandle PuertsGenTickerHandle;
	FTSTicker::FDelegateHandle AssetDiagnosticsTickerHandle;
	FTSTicker::FDelegateHandle SelectedAssetsExportTickerHandle;
	FTSTicker::FDelegateHandle EnsureCookSmokeMapTickerHandle;
	FTSTicker::FDelegateHandle EnsureStreamingValidationMapsTickerHandle;
	FTSTicker::FDelegateHandle EnsureUIValidationWidgetTickerHandle;
	IConsoleObject* ExportSelectedAssetsCommand = nullptr;
	IConsoleObject* EnsureCookSmokeMapCommand = nullptr;
	IConsoleObject* EnsureStreamingValidationMapsCommand = nullptr;
	IConsoleObject* EnsureUIValidationWidgetCommand = nullptr;
#endif
};
