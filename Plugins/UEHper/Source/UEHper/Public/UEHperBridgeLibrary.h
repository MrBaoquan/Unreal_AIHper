#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "UEHperRuntimeTypes.h"
#include "UEHperBridgeLibrary.generated.h"

class UUEHperRuntimeSubsystem;
class UUEHperResourceSubsystem;
class UUEHperLevelStreamingWatcher;
class UUserWidget;
class AUEHperUIWorldHostActor;

UCLASS()
class UEHPER_API UUEHperBridgeLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static UUEHperRuntimeSubsystem* GetRuntimeSubsystem(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static UUEHperResourceSubsystem* GetResourceSubsystem(const UObject* WorldContextObject);

    /** P4-H: 获取关卡流加载监听子系统（FWorldDelegates 桥） */
    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static UUEHperLevelStreamingWatcher* GetLevelStreamingWatcher(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static EUEHperRuntimeState GetRuntimeState(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static UWorld* ResolveWorldFromObject(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static FUEHperWorldContextInfo GetWorldContextInfo(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static APlayerController* GetPrimaryPlayerController(const UObject* WorldContextObject);

    UFUNCTION(BlueprintPure, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static bool IsValidObject(const UObject* Object);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge")
    static UObject* LoadObjectBySoftPath(TSoftObjectPtr<UObject> ObjectPath);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge")
    static UClass* LoadClassBySoftPath(TSoftClassPtr<UObject> ClassPath);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge")
    static UObject* LoadObjectByPath(const FString& ObjectPath, bool& bSuccess, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge")
    static UClass* LoadClassByPath(const FString& ClassPath, bool& bSuccess, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static UUserWidget* CreateWidgetSafe(const UObject* WorldContextObject, TSubclassOf<UUserWidget> WidgetClass, APlayerController* OwningPlayer, bool& bSuccess, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge", meta = (WorldContext = "WorldContextObject"))
    static bool OpenLevelSafe(const UObject* WorldContextObject, FName LevelName, FString& ErrorMessage);

    UFUNCTION(BlueprintCallable, Category = "UEHper|Bridge")
    static void ReportFrameworkError(const FString& Code, const FString& Message, const FString& Detail);

    /** 当前编辑器是否处于 VR Preview 模式（仅 WITH_EDITOR 有效，打包版恒为 false）。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Environment", meta = (DisplayName = "Is VR Preview Active"))
    static bool IsVRPreviewActive();

    /** 当前进程是否运行在 PIE 模式（含 PIE Standalone / PIE Listen Server / PIE Client；打包版恒为 false）。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|Environment", meta = (DisplayName = "Is Play In Editor"))
    static bool IsPlayInEditor();

    // ──────────────────────────────────────────────────────────────────────
    // World UI Host（通用 World Space UI 宿主，无业务/交互细节感知）
    // ──────────────────────────────────────────────────────────────────────

    /**
     * 在 World 中查找或自动 Spawn 一个 UI World Host Actor。
     * 查找规则：
     *   1) 优先匹配 UEHperSettings.DefaultUIWorldHostClass（业务子类）；
     *   2) 找不到则匹配框架基类 AUEHperUIWorldHostActor 的任意实例；
     *   3) 仍找不到则按 DefaultUIWorldHostClass（或基类）SpawnActor。
     * 同一 World 内多次调用返回同一实例（first-found）。
     */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI", meta = (WorldContext = "WorldContextObject"))
    static AUEHperUIWorldHostActor* ResolveUIWorldHost(const UObject* WorldContextObject);

    /** 在指定 Host 上挂载 Panel（转发到 Host->AttachPanel，方便 TS 桥接调用）。 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI")
    static UUserWidget* AttachPanelToHost(AUEHperUIWorldHostActor* Host,
                                          TSubclassOf<UUserWidget> WidgetClass,
                                          FName PanelKey,
                                          APlayerController* OwningPlayer,
                                          float DistanceCm,
                                          float PitchOffsetDeg,
                                          bool bFaceCameraOnSpawn,
                                          float DrawSizeX,
                                          float DrawSizeY,
                                          float Scale = 1.f,
                                          float OffsetRightCm = 0.f,
                                          float OffsetUpCm = 0.f);

    /** 从指定 Host 卸下 Panel（转发到 Host->DetachPanel）。 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI")
    static void DetachPanelFromHost(AUEHperUIWorldHostActor* Host, FName PanelKey);

private:
    static FUEHperWorldContextInfo BuildWorldContextInfo(const UWorld* World);
};
