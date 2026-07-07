#include "UEHperUIWorldHostActor.h"

#include "Blueprint/UserWidget.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/SceneComponent.h"
#include "Components/WidgetComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMathLibrary.h"   // UKismetMathLibrary::FindLookAtRotation
#include "UEHperPanelLifecycleAware.h"

AUEHperUIWorldHostActor::AUEHperUIWorldHostActor()
{
    PrimaryActorTick.bCanEverTick = false;
    bReplicates = false;
    SetReplicateMovement(false);

    SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
    SetRootComponent(SceneRoot);

    PanelWidget = CreateDefaultSubobject<UWidgetComponent>(TEXT("PanelWidget"));
    PanelWidget->SetupAttachment(SceneRoot);
    PanelWidget->SetWidgetSpace(EWidgetSpace::World);
    PanelWidget->SetDrawAtDesiredSize(false);
    PanelWidget->SetDrawSize(FVector2D(800.f, 600.f));
    PanelWidget->SetTwoSided(true);
    PanelWidget->SetVisibility(false);
    // 框架不假设业务采用何种交互方式（射线/手势/眼动）。
    // 默认关闭碰撞，让业务侧（项目子类或 BP）按需开启 ReceiveHardwareInput / 碰撞通道。
    PanelWidget->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

UUserWidget* AUEHperUIWorldHostActor::AttachPanel(TSubclassOf<UUserWidget> WidgetClass,
                                                  FName PanelKey,
                                                  APlayerController* OwningPlayer,
                                                  float DistanceCm,
                                                  float PitchOffsetDeg,
                                                  bool bFaceCameraOnSpawn,
                                                  float DrawSizeX,
                                                  float DrawSizeY,
                                                  float Scale,
                                                  float OffsetRightCm,
                                                  float OffsetUpCm)
{
    if (!WidgetClass)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachPanel: WidgetClass is null (Key=%s)"), *PanelKey.ToString());
        return nullptr;
    }
    if (PanelKey.IsNone())
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachPanel: PanelKey is None"));
        return nullptr;
    }

    UWorld* World = GetWorld();
    if (!World)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachPanel: no World"));
        return nullptr;
    }

    // 同层互斥：先卸下当前 Panel
    if (!CurrentPanelKey.IsNone())
    {
        DetachPanel(CurrentPanelKey);
    }

    APlayerController* ActualPC = OwningPlayer ? OwningPlayer : UGameplayStatics::GetPlayerController(World, 0);
    UUserWidget* NewWidget = ActualPC
        ? CreateWidget<UUserWidget>(ActualPC, WidgetClass)
        : CreateWidget<UUserWidget>(World, WidgetClass);

    if (!NewWidget)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachPanel: CreateWidget failed (Key=%s)"), *PanelKey.ToString());
        return nullptr;
    }

    PanelWidget->SetDrawSize(FVector2D(DrawSizeX, DrawSizeY));
    PanelWidget->SetWidget(NewWidget);
    PanelWidget->SetVisibility(true);

    // 应用用户在 manifest world.scale 指定的缩放
    PanelWidget->SetRelativeScale3D(FVector(Scale));

    // 一次性定位到玩家前方（无动画，瞬间定格）
    FVector TargetLoc;
    FQuat TargetRot;
    ComputeTargetTransform(ActualPC, DistanceCm, PitchOffsetDeg, bFaceCameraOnSpawn, OffsetRightCm, OffsetUpCm, TargetLoc, TargetRot);
    SetActorLocationAndRotation(TargetLoc, TargetRot);

    CurrentWidget = NewWidget;
    CurrentPanelKey = PanelKey;

    // 1) 接口直调（widget 实现 IUEHperPanelLifecycleAware 即生效，不依赖 BP 连线）
    if (NewWidget->Implements<UUEHperPanelLifecycleAware>())
    {
        UE_LOG(LogTemp, Log, TEXT("[UEHperUIWorldHost] AttachPanel: invoke OnAttachedToHost on %s (Key=%s)"), *NewWidget->GetName(), *PanelKey.ToString());
        IUEHperPanelLifecycleAware::Execute_OnAttachedToHost(NewWidget, this, PanelKey);
    }
    else
    {
        UE_LOG(LogTemp, Verbose, TEXT("[UEHperUIWorldHost] AttachPanel: %s does NOT implement IUEHperPanelLifecycleAware (Key=%s)"), *NewWidget->GetName(), *PanelKey.ToString());
    }

    // 2) BP delegate（保留兼容，BP_UIManager 可选订阅）
    OnPanelAttached.Broadcast(NewWidget, PanelKey);
    return NewWidget;
}

void AUEHperUIWorldHostActor::AttachExistingPanel(UUserWidget* Widget,
                                                 FName PanelKey,
                                                 APlayerController* OwningPlayer,
                                                 float DistanceCm,
                                                 float PitchOffsetDeg,
                                                 bool bFaceCameraOnSpawn,
                                                 float DrawSizeX,
                                                 float DrawSizeY,
                                                 float Scale,
                                                 float OffsetRightCm,
                                                 float OffsetUpCm)
{
    if (!Widget)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachExistingPanel: Widget is null (Key=%s)"), *PanelKey.ToString());
        return;
    }
    if (PanelKey.IsNone())
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperUIWorldHost] AttachExistingPanel: PanelKey is None"));
        return;
    }

    if (!CurrentPanelKey.IsNone() && CurrentPanelKey != PanelKey)
    {
        DetachPanel(CurrentPanelKey);
    }

    if (!OwningPlayer)
    {
        OwningPlayer = UGameplayStatics::GetPlayerController(GetWorld(), 0);
    }

    PanelWidget->SetDrawSize(FVector2D(DrawSizeX, DrawSizeY));
    PanelWidget->SetWidget(Widget);
    PanelWidget->SetVisibility(true);

    // 应用用户在 manifest world.scale 指定的缩放
    PanelWidget->SetRelativeScale3D(FVector(Scale));

    // 一次性定位到玩家前方（无动画，瞬间定格）
    FVector TargetLoc;
    FQuat TargetRot;
    ComputeTargetTransform(OwningPlayer, DistanceCm, PitchOffsetDeg, bFaceCameraOnSpawn, OffsetRightCm, OffsetUpCm, TargetLoc, TargetRot);
    SetActorLocationAndRotation(TargetLoc, TargetRot);

    CurrentWidget = Widget;
    CurrentPanelKey = PanelKey;

    // 1) 接口直调（widget 实现 IUEHperPanelLifecycleAware 即生效，不依赖 BP 连线）
    if (Widget->Implements<UUEHperPanelLifecycleAware>())
    {
        UE_LOG(LogTemp, Log, TEXT("[UEHperUIWorldHost] AttachExistingPanel: invoke OnAttachedToHost on %s (Key=%s)"), *Widget->GetName(), *PanelKey.ToString());
        IUEHperPanelLifecycleAware::Execute_OnAttachedToHost(Widget, this, PanelKey);
    }
    else
    {
        UE_LOG(LogTemp, Verbose, TEXT("[UEHperUIWorldHost] AttachExistingPanel: %s does NOT implement IUEHperPanelLifecycleAware (Key=%s)"), *Widget->GetName(), *PanelKey.ToString());
    }

    // 2) BP delegate（保留兼容）
    OnPanelAttached.Broadcast(Widget, PanelKey);
}

void AUEHperUIWorldHostActor::DetachPanel(FName PanelKey)
{
    if (PanelKey.IsNone() || PanelKey != CurrentPanelKey || !CurrentWidget)
    {
        return;
    }

    UUserWidget* WidgetBeingDetached = CurrentWidget;
    const FName KeyBeingDetached = CurrentPanelKey;

    // 1) 接口直调（先于 BP delegate，让 widget 在仍挂载时清理）
    if (WidgetBeingDetached->Implements<UUEHperPanelLifecycleAware>())
    {
        UE_LOG(LogTemp, Log, TEXT("[UEHperUIWorldHost] DetachPanel: invoke OnDetachedFromHost on %s (Key=%s)"), *WidgetBeingDetached->GetName(), *KeyBeingDetached.ToString());
        IUEHperPanelLifecycleAware::Execute_OnDetachedFromHost(WidgetBeingDetached, KeyBeingDetached);
    }

    // 2) BP delegate
    OnPanelDetached.Broadcast(WidgetBeingDetached, KeyBeingDetached);

    // 瞬间清理（隐藏动画由 TS 侧 closeAsync → runTransition('hide') → 播完 → unmountWidget 控制时序）
    if (PanelWidget)
    {
        PanelWidget->SetWidget(nullptr);
        PanelWidget->SetVisibility(false);
    }
    CurrentWidget = nullptr;
    CurrentPanelKey = NAME_None;
}

void AUEHperUIWorldHostActor::ComputeTargetTransform(APlayerController* OwningPlayer, float DistanceCm, float PitchOffsetDeg,
    bool bFaceCamera, float OffsetRightCm, float OffsetUpCm,
    FVector& OutLoc, FQuat& OutRot) const
{
    if (!OwningPlayer)
    {
        OwningPlayer = UGameplayStatics::GetPlayerController(GetWorld(), 0);
    }

    FVector CamLoc = FVector::ZeroVector;
    FRotator CamRot = FRotator::ZeroRotator;

    if (OwningPlayer)
    {
        if (APlayerCameraManager* CamMgr = OwningPlayer->PlayerCameraManager)
        {
            CamLoc = CamMgr->GetCameraLocation();
            CamRot = CamMgr->GetCameraRotation();
        }
        else
        {
            OwningPlayer->GetPlayerViewPoint(CamLoc, CamRot);
        }
    }

    const FVector Forward = CamRot.Vector();
    OutLoc = CamLoc + Forward * DistanceCm;

    // 相机视角平面内的上下左右偏移（cm）
    if (OffsetRightCm != 0.f || OffsetUpCm != 0.f)
    {
        const FVector Right = CamRot.RotateVector(FVector::RightVector);
        const FVector Up    = CamRot.RotateVector(FVector::UpVector);
        OutLoc += Right * OffsetRightCm + Up * OffsetUpCm;
    }

    FRotator PanelRot = FRotator::ZeroRotator;
    if (bFaceCamera)
    {
        // FindLookAtRotation(面板位置, 相机位置)：让面板从自身位置看向相机 → +X（正面）朝向头盔
        PanelRot = UKismetMathLibrary::FindLookAtRotation(OutLoc, CamLoc);
        PanelRot.Pitch += PitchOffsetDeg;
        PanelRot.Roll = 0.f;
        // 兜底：若 WidgetComponent 正面渲染在 -X 侧，勾 bFlipFacing 翻转 180°
        if (bFlipFacing)
        {
            PanelRot.Yaw += 180.f;
        }
    }
    OutRot = PanelRot.Quaternion();
}

void AUEHperUIWorldHostActor::SnapshotInFrontOfCamera(APlayerController* OwningPlayer, float DistanceCm, float PitchOffsetDeg, bool bFaceCameraOnSpawn)
{
    FVector TargetLoc;
    FQuat TargetRot;
    ComputeTargetTransform(OwningPlayer, DistanceCm, PitchOffsetDeg, bFaceCameraOnSpawn, 0.f, 0.f, TargetLoc, TargetRot);
    SetActorLocationAndRotation(TargetLoc, TargetRot);
}
