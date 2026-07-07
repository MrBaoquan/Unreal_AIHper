#include "UEHperEditor.h"

#include "Async/Async.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Algo/Sort.h"
#include "ContentBrowserModule.h"
#include "ContentBrowserMenuContexts.h"
#include "Framework/Notifications/NotificationManager.h"
#include "HAL/FileManager.h"
#include "HAL/PlatformProcess.h"
#include "IContentBrowserSingleton.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/FileHelper.h"
#include "Misc/MessageDialog.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "ToolMenu.h"
#include "ToolMenus.h"
#include "UEHperSettings.h"
#include "Widgets/Notifications/SNotificationList.h"

#define LOCTEXT_NAMESPACE "FUEHperEditorModule"

DEFINE_LOG_CATEGORY_STATIC(LogUEHperEditor, Log, All);

namespace
{
    void DeduplicateSortedStrings(TArray<FString>& Values)
    {
        if (Values.Num() <= 1)
        {
            return;
        }

        int32 WriteIndex = 1;
        for (int32 ReadIndex = 1; ReadIndex < Values.Num(); ++ReadIndex)
        {
            if (Values[ReadIndex] == Values[WriteIndex - 1])
            {
                continue;
            }

            if (WriteIndex != ReadIndex)
            {
                Values[WriteIndex] = MoveTemp(Values[ReadIndex]);
            }
            ++WriteIndex;
        }

        Values.SetNum(WriteIndex);
    }

    TArray<FString> ResolveFolderMenuPaths(const UContentBrowserFolderContext* FolderContext)
    {
        TArray<FString> SelectedFolders;
        if (FolderContext == nullptr)
        {
            return SelectedFolders;
        }

        SelectedFolders.Reserve(FolderContext->SelectedPackagePaths.Num());
        for (const FString& FolderPath : FolderContext->SelectedPackagePaths)
        {
            if (!FolderPath.IsEmpty())
            {
                SelectedFolders.Add(FolderPath);
            }
        }

        SelectedFolders.Sort();
        DeduplicateSortedStrings(SelectedFolders);
        return SelectedFolders;
    }

    TArray<FString> NormalizeFolderPaths(TArray<FString> SelectedFolders)
    {
        SelectedFolders.RemoveAll([](const FString& FolderPath)
        {
            return FolderPath.IsEmpty();
        });

        SelectedFolders.Sort();
        DeduplicateSortedStrings(SelectedFolders);
        return SelectedFolders;
    }

    FString ExpandUEHperEditorPath(FString Value, bool bMakeAbsolute = true)
    {
        Value.ReplaceInline(TEXT("{ProjectDir}"), *FPaths::ProjectDir());
        Value.ReplaceInline(TEXT("{ProjectContentDir}"), *FPaths::ProjectContentDir());
        Value.ReplaceInline(TEXT("{ProjectConfigDir}"), *FPaths::ProjectConfigDir());
        Value.ReplaceInline(TEXT("{ProjectIntermediateDir}"), *FPaths::ProjectIntermediateDir());
        Value.ReplaceInline(TEXT("{ProjectSavedDir}"), *FPaths::ProjectSavedDir());
        if (const TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("UEHper")))
        {
            Value.ReplaceInline(TEXT("{PluginDir}"), *FPaths::ConvertRelativePathToFull(Plugin->GetBaseDir()));
        }
        FPaths::NormalizeFilename(Value);
        if (bMakeAbsolute && FPaths::IsRelative(Value))
        {
            Value = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir(), Value);
        }
        return Value;
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

    void SetJsonStringField(const TSharedPtr<FJsonObject>& Object, const TCHAR* FieldName, const FString& Value)
    {
        Object->SetStringField(FieldName, Value);
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

    bool WriteSelectedAssetsJson(const TArray<FAssetData>& Assets, const FString& OutputPath)
    {
        TSharedRef<FJsonObject> ResultObject = MakeShared<FJsonObject>();
        TArray<TSharedPtr<FJsonValue>> AssetItems;
        for (const FAssetData& AssetData : Assets)
        {
            AssetItems.Add(MakeShared<FJsonValueObject>(BuildSelectedAssetJson(AssetData)));
        }

        ResultObject->SetBoolField(TEXT("success"), true);
        ResultObject->SetNumberField(TEXT("assetCount"), Assets.Num());
        ResultObject->SetArrayField(TEXT("assets"), AssetItems);

        FString OutputJson;
        TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputJson);
        if (!FJsonSerializer::Serialize(ResultObject, Writer))
        {
            UE_LOG(LogUEHperEditor, Error, TEXT("Failed to serialize selected assets JSON."));
            return false;
        }

        IFileManager::Get().MakeDirectory(*FPaths::GetPath(OutputPath), true);
        if (!FFileHelper::SaveStringToFile(OutputJson, *OutputPath))
        {
            UE_LOG(LogUEHperEditor, Error, TEXT("Failed to write selected assets JSON: %s"), *OutputPath);
            return false;
        }

        UE_LOG(LogUEHperEditor, Display, TEXT("Exported %d assets to %s."), Assets.Num(), *OutputPath);
        return true;
    }

    FString QuoteForCommandLine(const FString& Value)
    {
        FString Escaped = Value;
        Escaped.ReplaceInline(TEXT("\""), TEXT("\\\""));
        return FString::Printf(TEXT("\"%s\""), *Escaped);
    }

    FString TrimCliMessage(const FString& Message)
    {
        FString Trimmed = Message.TrimStartAndEnd();
        constexpr int32 MaxMessageLength = 1600;
        if (Trimmed.Len() > MaxMessageLength)
        {
            Trimmed = Trimmed.Left(MaxMessageLength) + TEXT("\n...");
        }
        return Trimmed;
    }

    TSharedPtr<SNotificationItem> ShowManifestNotification(const FText& Text, SNotificationItem::ECompletionState State, bool bFireAndForget = false)
    {
        FNotificationInfo Info(Text);
        Info.bFireAndForget = bFireAndForget;
        Info.bUseLargeFont = false;
        Info.FadeOutDuration = 0.25f;
        Info.ExpireDuration = bFireAndForget ? 6.0f : 0.0f;
        Info.bUseSuccessFailIcons = true;

        TSharedPtr<SNotificationItem> Notification = FSlateNotificationManager::Get().AddNotification(Info);
        if (Notification.IsValid())
        {
            Notification->SetCompletionState(State);
        }
        return Notification;
    }

    bool RunManifestCliSync(const FString& Executable, const FString& Arguments, const FString& WorkingDirectory, FString& OutCliMessage)
    {
        int32 ReturnCode = 0;
        FString StdOut;
        FString StdErr;
        UE_LOG(LogUEHperEditor, Display, TEXT("Running manifest CLI: %s %s"), *Executable, *Arguments);
        const bool bProcessStarted = FPlatformProcess::ExecProcess(*Executable, *Arguments, &ReturnCode, &StdOut, &StdErr, *WorkingDirectory);
        if (!bProcessStarted || ReturnCode != 0)
        {
            UE_LOG(LogUEHperEditor, Error, TEXT("Manifest CLI failed: started=%d return=%d stdout=%s stderr=%s"), bProcessStarted ? 1 : 0, ReturnCode, *StdOut, *StdErr);
            FMessageDialog::Open(EAppMsgType::Ok, FText::Format(LOCTEXT("ManifestCliFailed", "UEHper manifest CLI failed.\nReturnCode: {0}\n\n{1}"), FText::AsNumber(ReturnCode), FText::FromString(StdErr.IsEmpty() ? StdOut : StdErr)));
            return false;
        }

        UE_LOG(LogUEHperEditor, Display, TEXT("Manifest CLI completed. %s"), *StdOut);
        OutCliMessage = TrimCliMessage(StdOut.IsEmpty() ? TEXT("TypeScript manifest files were updated.") : StdOut);
        return true;
    }

    void RunManifestCliAsync(const FString& JsonPath, int32 AssetCount)
    {
        const UUEHperSettings* Settings = GetDefault<UUEHperSettings>();
        if (!Settings->bRunManifestCliAfterExport)
        {
            ShowManifestNotification(
                FText::Format(
                    LOCTEXT("ManifestExportOnly", "UEHper exported selected-assets JSON for {0} assets. CLI execution is disabled in Project Settings."),
                    FText::AsNumber(AssetCount)),
                SNotificationItem::CS_Success,
                true);
            return;
        }

        FString Executable = ExpandUEHperEditorPath(Settings->ManifestCliExecutable, false);
        FString Arguments = Settings->ManifestCliArguments;
        FString WorkingDirectory = Settings->ManifestCliWorkingDirectory.Path;
        if (WorkingDirectory.IsEmpty())
        {
            WorkingDirectory = FPaths::ProjectDir();
        }

        WorkingDirectory = ExpandUEHperEditorPath(WorkingDirectory);
        Arguments.ReplaceInline(TEXT("{JsonPath}"), *JsonPath);
        Arguments.ReplaceInline(TEXT("{JsonPathQuoted}"), *QuoteForCommandLine(JsonPath));
        Arguments.ReplaceInline(TEXT("{ProjectDir}"), *FPaths::ProjectDir());

        TSharedPtr<SNotificationItem> Notification = ShowManifestNotification(
            FText::Format(
                LOCTEXT("ManifestGenerationStarted", "Generating UEHper manifest for {0} assets..."),
                FText::AsNumber(AssetCount)),
            SNotificationItem::CS_Pending,
            false);

        Async(EAsyncExecution::ThreadPool, [Executable, Arguments, WorkingDirectory, AssetCount, Notification]()
        {
            FString CliMessage;
            const bool bSucceeded = RunManifestCliSync(Executable, Arguments, WorkingDirectory, CliMessage);
            AsyncTask(ENamedThreads::GameThread, [bSucceeded, CliMessage, AssetCount, Notification]()
            {
                if (Notification.IsValid())
                {
                    Notification->SetText(
                        bSucceeded
                            ? FText::Format(
                                LOCTEXT("ManifestGenerationComplete", "UEHper manifest generation completed for {0} assets.\n{1}"),
                                FText::AsNumber(AssetCount),
                                FText::FromString(CliMessage))
                            : FText::Format(
                                LOCTEXT("ManifestGenerationFailed", "UEHper manifest generation failed for {0} assets. Check Output Log for details."),
                                FText::AsNumber(AssetCount)));
                    Notification->SetCompletionState(bSucceeded ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail);
                    Notification->ExpireAndFadeout();
                }
                else
                {
                    ShowManifestNotification(
                        bSucceeded
                            ? FText::Format(
                                LOCTEXT("ManifestGenerationCompleteFallback", "UEHper manifest generation completed for {0} assets.\n{1}"),
                                FText::AsNumber(AssetCount),
                                FText::FromString(CliMessage))
                            : FText::Format(
                                LOCTEXT("ManifestGenerationFailedFallback", "UEHper manifest generation failed for {0} assets. Check Output Log for details."),
                                FText::AsNumber(AssetCount)),
                        bSucceeded ? SNotificationItem::CS_Success : SNotificationItem::CS_Fail,
                        true);
                }
            });
        });
    }

    TArray<FAssetData> NormalizeManifestAssets(TArray<FAssetData> Assets)
    {
        Assets.RemoveAll([](const FAssetData& AssetData)
        {
            return !AssetData.IsValid() || AssetData.IsRedirector();
        });

        Algo::Sort(Assets, [](const FAssetData& Left, const FAssetData& Right)
        {
            return Left.GetObjectPathString() < Right.GetObjectPathString();
        });

        TSet<FString> SeenObjectPaths;
        TArray<FAssetData> UniqueAssets;
        UniqueAssets.Reserve(Assets.Num());
        for (const FAssetData& AssetData : Assets)
        {
            const FString ObjectPath = AssetData.GetObjectPathString();
            if (ObjectPath.IsEmpty() || SeenObjectPaths.Contains(ObjectPath))
            {
                continue;
            }
            SeenObjectPaths.Add(ObjectPath);
            UniqueAssets.Add(AssetData);
        }
        return UniqueAssets;
    }

    void ExportAssetsAndRunManifest(const TArray<FAssetData>& Assets)
    {
        const UUEHperSettings* Settings = GetDefault<UUEHperSettings>();
        if (!Settings->bEnableManifestContextMenus)
        {
            ShowManifestNotification(LOCTEXT("ManifestToolsDisabled", "UEHper manifest context menus are disabled in Project Settings."), SNotificationItem::CS_Fail, true);
            return;
        }
        const TArray<FAssetData> ManifestAssets = NormalizeManifestAssets(Assets);
        if (ManifestAssets.Num() == 0)
        {
            ShowManifestNotification(LOCTEXT("NoAssetsSelected", "No assets were selected for manifest generation."), SNotificationItem::CS_Fail, true);
            return;
        }

        const FString OutputPath = ExpandUEHperEditorPath(Settings->ManifestSelectedAssetsOutputPath);
        if (!WriteSelectedAssetsJson(ManifestAssets, OutputPath))
        {
            ShowManifestNotification(LOCTEXT("ExportSelectedAssetsFailed", "Failed to export selected assets JSON. See Output Log for details."), SNotificationItem::CS_Fail, true);
            return;
        }

        RunManifestCliAsync(OutputPath, ManifestAssets.Num());
    }

    void ExportFoldersAndRunManifest(const TArray<FString>& InitialSelectedFolders)
    {
        TArray<FString> SelectedFolders = NormalizeFolderPaths(InitialSelectedFolders);
        if (SelectedFolders.Num() == 0)
        {
            FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
            ContentBrowserModule.Get().GetSelectedFolders(SelectedFolders);
            SelectedFolders = NormalizeFolderPaths(MoveTemp(SelectedFolders));
            UE_LOG(LogUEHperEditor, Verbose, TEXT("Folder manifest fallback selected folders count=%d."), SelectedFolders.Num());
        }

        TArray<FAssetData> Assets;
        FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
        for (const FString& FolderPath : SelectedFolders)
        {
            TArray<FAssetData> FolderAssets;
            UE_LOG(LogUEHperEditor, Display, TEXT("Collecting manifest assets from selected folder: %s"), *FolderPath);
            AssetRegistryModule.Get().GetAssetsByPath(FName(*FolderPath), FolderAssets, true);
            Assets.Append(FolderAssets);
        }

        ExportAssetsAndRunManifest(Assets);
    }
}

void FUEHperEditorModule::StartupModule()
{
    if (!IsRunningCommandlet())
    {
        UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FUEHperEditorModule::RegisterMenus));
    }
}

void FUEHperEditorModule::ShutdownModule()
{
    if (UToolMenus::IsToolMenuUIEnabled())
    {
        UToolMenus::UnRegisterStartupCallback(this);
        UToolMenus::UnregisterOwner(this);
    }
}

void FUEHperEditorModule::RegisterMenus()
{
    UToolMenu* AssetMenu = UToolMenus::Get()->ExtendMenu(TEXT("ContentBrowser.AssetContextMenu"));
    FToolMenuSection& AssetSection = AssetMenu->FindOrAddSection(TEXT("UEHper"), LOCTEXT("UEHperSection", "UEHper"));
    AssetSection.AddMenuEntry(
        TEXT("UEHperAddSelectedAssetsToManifest"),
        LOCTEXT("AddSelectedAssetsToManifest", "Generate UEHper Manifest from Selection"),
        LOCTEXT("AddSelectedAssetsToManifestTooltip", "Generate selected-assets data and update TypeScript manifest files in one editor action."),
        FSlateIcon(),
        FUIAction(FExecuteAction::CreateRaw(this, &FUEHperEditorModule::AddSelectedAssetsToManifest))
    );

    UToolMenu* FolderMenu = UToolMenus::Get()->ExtendMenu(TEXT("ContentBrowser.FolderContextMenu"));
    FToolMenuSection& FolderSection = FolderMenu->FindOrAddSection(TEXT("UEHper"), LOCTEXT("UEHperSection", "UEHper"));
    FolderSection.AddDynamicEntry(TEXT("UEHperAddFolderAssetsToManifest"), FNewToolMenuSectionDelegate::CreateLambda([this](FToolMenuSection& InSection)
    {
        const TArray<FString> ContextSelectedFolders = ResolveFolderMenuPaths(InSection.FindContext<UContentBrowserFolderContext>());
        InSection.AddMenuEntry(
            TEXT("UEHperAddFolderAssetsToManifest"),
            LOCTEXT("AddFolderAssetsToManifest", "Generate UEHper Manifest from Folder"),
            LOCTEXT("AddFolderAssetsToManifestTooltip", "Recursively collect unique assets under selected Content Browser folders and update TypeScript manifest files in one editor action."),
            FSlateIcon(),
            FUIAction(FExecuteAction::CreateLambda([this, ContextSelectedFolders]()
            {
                if (ContextSelectedFolders.Num() > 0)
                {
                    ExportFoldersAndRunManifest(ContextSelectedFolders);
                    return;
                }

                AddSelectedFoldersToManifest();
            }))
        );
    }));
}

void FUEHperEditorModule::AddSelectedAssetsToManifest()
{
    FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>(TEXT("ContentBrowser"));
    TArray<FAssetData> SelectedAssets;
    ContentBrowserModule.Get().GetSelectedAssets(SelectedAssets);
    ExportAssetsAndRunManifest(SelectedAssets);
}

void FUEHperEditorModule::AddSelectedFoldersToManifest()
{
    ExportFoldersAndRunManifest({});
}

IMPLEMENT_MODULE(FUEHperEditorModule, UEHperEditor)

#undef LOCTEXT_NAMESPACE
