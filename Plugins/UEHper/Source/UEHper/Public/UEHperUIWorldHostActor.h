#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UEHperUIWorldHostActor.generated.h"

class UWidgetComponent;
class UUserWidget;
class USceneComponent;

/**
 * 通用 World UI 宿主 Actor（框架层）。
 *
 * 职责（仅 3 件，保持通用）：
 *   1. 复用一个 UWidgetComponent 承载当前显示的 Panel UserWidget。
 *   2. AttachPanel 时一次性把宿主 snapshot 到玩家正前方（之后不跟随）。
 *   3. 通过 OnPanelAttached/OnPanelDetached 广播生命周期事件，业务侧（项目 BP/C++）
 *      自行决定是否做交互绑定（Box、Trace、Gaze 等），框架不感知。
 *
 * 关注点分离：
 *   - 框架不知道任何交互模态（HandGesture/手柄/眼动），不引入 Box/Trace 概念。
 *   - 业务侧通过订阅 OnPanelAttached delegate 拿到 (Widget, Key) 自己做后续处理。
 *
 * 业务覆盖：
 *   UEHperSettings.DefaultUIWorldHostClass 可指定业务子类（如 BP_UIManager），
 *   UEHperBridgeLibrary.ResolveUIWorldHost 会按此配置 spawn / 查找实例。
 */
UCLASS(Blueprintable, BlueprintType, ClassGroup = (UEHper), meta = (DisplayName = "UEHper UI World Host"))
class UEHPER_API AUEHperUIWorldHostActor : public AActor
{
    GENERATED_BODY()

public:
    AUEHperUIWorldHostActor();

    // 动画已移交 UMG Widget Animation + TS UIController transition 钩子。
    // 宿主只负责一次性定位（FindLookAtRotation 朝向） + SetVisibility，不再 Tick。

    /**
     * 在玩家前方挂载指定 WidgetClass 的 UserWidget；快照式定位，后续不跟随。
     * 若当前已有其他 PanelKey 显示，会先 DetachPanel(CurrentPanelKey)。
     *
     * @param WidgetClass       要创建的 UserWidget 类
     * @param PanelKey          面板唯一 Key（UIService 侧的 manifest key 同名）
     * @param OwningPlayer      可空，用于 CreateWidget 上下文；为空则取 PlayerIndex 0
     * @param DistanceCm        放置距离（相机前方 cm），默认 100
     * @param PitchOffsetDeg    俯仰偏移（VR 抬头/低头舒适区微调），默认 0
     * @param bFaceCameraOnSpawn 是否让面板正对玩家（默认 true）
     * @param DrawSizeX/Y       Widget 在世界中的绘制尺寸（默认 800x600；UWidgetComponent 单位 = cm）
     * @param Scale             面板整体缩放（默认 1）。应用为 PanelWidget->RelativeScale3D
     * @param OffsetRightCm     相机视角平面内向右偏移（cm），默认 0。负数向左
     * @param OffsetUpCm        相机视角平面内向上偏移（cm），默认 0。负数向下
     * @return                  挂载成功的 UserWidget 实例；失败返回 nullptr
     */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI")
    UUserWidget* AttachPanel(TSubclassOf<UUserWidget> WidgetClass,
                             FName PanelKey,
                             APlayerController* OwningPlayer = nullptr,
                             float DistanceCm = 100.f,
                             float PitchOffsetDeg = 0.f,
                             bool bFaceCameraOnSpawn = true,
                             float DrawSizeX = 800.f,
                             float DrawSizeY = 600.f,
                             float Scale = 1.f,
                             float OffsetRightCm = 0.f,
                             float OffsetUpCm = 0.f);

    /**
     * 挂载一个已存在的 UserWidget 实例（不创建新 widget）。
     * 适用于上层（如 UIService）自己管理 widget 缓存的场景：
     *   - UIService cache=true 时复用同一 widget 实例，反复 attach/detach 不重建
     *   - 框架仅负责定位与挂到 PanelWidgetComponent
     */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI")
    void AttachExistingPanel(UUserWidget* Widget,
                             FName PanelKey,
                             APlayerController* OwningPlayer = nullptr,
                             float DistanceCm = 100.f,
                             float PitchOffsetDeg = 0.f,
                             bool bFaceCameraOnSpawn = true,
                             float DrawSizeX = 800.f,
                             float DrawSizeY = 600.f,
                             float Scale = 1.f,
                             float OffsetRightCm = 0.f,
                             float OffsetUpCm = 0.f);

    /** 卸下指定 Key 的面板；不销毁 widget 实例，UIService 侧负责缓存策略。 */
    UFUNCTION(BlueprintCallable, Category = "UEHper|UI")
    void DetachPanel(FName PanelKey);

    /** 当前是否有面板正在显示。BP 侧用于控制抛物线/手势是否生效：面板打开期间抑制抛物线。 */
    UFUNCTION(BlueprintPure, Category = "UEHper|UI")
    bool HasActivePanel() const { return CurrentWidget != nullptr; }

    UFUNCTION(BlueprintPure, Category = "UEHper|UI")
    FName GetCurrentPanelKey() const { return CurrentPanelKey; }

    UFUNCTION(BlueprintPure, Category = "UEHper|UI")
    UUserWidget* GetCurrentWidget() const { return CurrentWidget; }

    UFUNCTION(BlueprintPure, Category = "UEHper|UI")
    UWidgetComponent* GetPanelWidgetComponent() const { return PanelWidget; }

    /** 当一个面板被挂载到世界后广播：业务侧可订阅做交互绑定（Box/Trace/Gaze 等）。 */
    DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FUEHperPanelLifecycleEvent, UUserWidget*, Widget, FName, PanelKey);

    UPROPERTY(BlueprintAssignable, Category = "UEHper|UI")
    FUEHperPanelLifecycleEvent OnPanelAttached;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|UI")
    FUEHperPanelLifecycleEvent OnPanelDetached;

    /** 朝向兜底开关：若面板正面渲染在 -X 侧，勾上翻转 180° */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|UI|Placement")
    bool bFlipFacing = false;

protected:
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|UI")
    TObjectPtr<USceneComponent> SceneRoot;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|UI")
    TObjectPtr<UWidgetComponent> PanelWidget;

    UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|UI")
    FName CurrentPanelKey;

    UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|UI")
    TObjectPtr<UUserWidget> CurrentWidget;

private:
    /** 一次性把宿主放到相机前方（无偏移路径用）。 */
    void SnapshotInFrontOfCamera(APlayerController* OwningPlayer, float DistanceCm, float PitchOffsetDeg, bool bFaceCameraOnSpawn);

    /** 计算面板应放置的目标位姿（位置+朝向），不直接 Set。
     *  朝向用 UKismetMathLibrary::FindLookAtRotation(PanelLoc, CamLoc) 让面板正面对相机。
     *  OffsetRightCm/OffsetUpCm 为相机视角平面内的左右/上下偏移（cm）。 */
    void ComputeTargetTransform(APlayerController* OwningPlayer, float DistanceCm, float PitchOffsetDeg,
        bool bFaceCamera, float OffsetRightCm, float OffsetUpCm,
        FVector& OutLoc, FQuat& OutRot) const;
};
