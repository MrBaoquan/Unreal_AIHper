#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperSettings.generated.h"

UCLASS(Config = UEHper, DefaultConfig, meta = (DisplayName = "UEHper"))
class UEHPER_API UUEHperSettings : public UDeveloperSettings
{
    GENERATED_BODY()

public:
    UUEHperSettings();

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    bool bEnableUEHperRuntime = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    EUEHperStartupPolicy StartupPolicy = EUEHperStartupPolicy::Auto;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    EUEHperRuntimeScope RuntimeScope = EUEHperRuntimeScope::GameInstance;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    EUEHperWorldContextPolicy WorldContextPolicy = EUEHperWorldContextPolicy::PIEIsolated;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    FString ScriptRoot = TEXT("JavaScript");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    FString FrameworkModule = TEXT("puerts_uehper/Framework/bootstrap");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    FString EntryModule = TEXT("Game/GameApp");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    bool bEnableEditorRuntime = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    bool bEnableHotReload = false;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    bool bEnableDiagnosticsOverlay = false;

    /** TS bootstrap 超时（秒）。0 或负值表示禁用 watchdog。AppCreated 后超过该时间仍未收到 NotifyBootstrapResult 视为失败。 */
    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime", meta = (ClampMin = "0", UIMin = "0", UIMax = "300"))
    float BootstrapTimeoutSeconds = 30.f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    TArray<FString> AdditionalScriptRoots;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Runtime")
    FDirectoryPath CookedScriptDirectory;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    bool bEnableManifestContextMenus = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    bool bRunManifestCliAfterExport = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    FString ManifestSelectedAssetsOutputPath = TEXT("{ProjectIntermediateDir}/UEHper/SelectedAssets/selected-assets.json");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    FString ManifestCliExecutable = TEXT("cmd.exe");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    FString ManifestCliArguments = TEXT("/C npx --no-install puerts_uehper manifest selected \"{JsonPath}\"");

    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "Editor|Manifest")
    FDirectoryPath ManifestCliWorkingDirectory;

    /**
     * 默认 World UI Host Actor 类（可被业务覆盖）。
     * 当 UEHperBridgeLibrary.ResolveUIWorldHost 在 World 中找不到任何 AUEHperUIWorldHostActor 实例时，
     * 会按此类自动 Spawn 一个。业务可填自定义子类（如 /Game/Game/UI/BP_UIManager.BP_UIManager_C）
     * 以注入项目特化的交互绑定逻辑（手势 Box / 射线 / 眼动等），框架本身保持通用。
     * 留空时使用框架基类 AUEHperUIWorldHostActor。
     */
    UPROPERTY(Config, EditAnywhere, BlueprintReadOnly, Category = "UI",
              meta = (MetaClass = "/Script/UEHper.UEHperUIWorldHostActor", AllowAbstract = "false"))
    FSoftClassPath DefaultUIWorldHostClass;

    virtual FName GetCategoryName() const override;
};
