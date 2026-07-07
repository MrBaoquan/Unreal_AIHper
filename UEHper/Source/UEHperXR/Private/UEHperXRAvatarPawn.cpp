#include "UEHperXRAvatarPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/WidgetComponent.h"
#include "Net/UnrealNetwork.h"
#include "UEHperXRLocalPoseProvider.h"

AUEHperXRAvatarPawn::AUEHperXRAvatarPawn()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bStartWithTickEnabled = true;
    bReplicates = true;
    SetReplicateMovement(true);

    CollisionCylinder = CreateDefaultSubobject<UCapsuleComponent>(TEXT("CollisionCylinder"));
    CollisionCylinder->SetCapsuleSize(34.0f, 88.0f);
    RootComponent = CollisionCylinder;

    VROrigin = CreateDefaultSubobject<USceneComponent>(TEXT("VROrigin"));
    VROrigin->SetupAttachment(RootComponent);

    AvatarMesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("CharacterMesh0"));
    AvatarMesh->SetupAttachment(RootComponent);
    AvatarMesh->SetRelativeRotation(FRotator(0.0f, -90.0f, 0.0f));
    AvatarMesh->SetOwnerNoSee(true);

    CameraComponent = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    CameraComponent->SetupAttachment(VROrigin);

    NameplateWidget = CreateDefaultSubobject<UWidgetComponent>(TEXT("PlayerInfoWidget"));
    NameplateWidget->SetupAttachment(RootComponent);
    NameplateWidget->SetVisibility(false);
    NameplateWidget->SetWidgetSpace(EWidgetSpace::Screen);
    NameplateWidget->SetOwnerNoSee(true);
}

void AUEHperXRAvatarPawn::BeginPlay()
{
    Super::BeginPlay();

    LastServerReportedLocation = GetActorLocation();
    BodyYaw = GetActorRotation().Yaw;
    ApplyBodyYawToMesh();
    RefreshRemotePosePresentation();
}

void AUEHperXRAvatarPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    if (IsLocallyControlled())
    {
        UpdateLocalHeadPose();
        SyncPawnToHMD();
        SyncClientXRAvatarPoseToServer();
    }

    if (GetLocalRole() == ROLE_SimulatedProxy && bHasSimProxyTarget)
    {
        const FVector NewLoc = FMath::VInterpTo(GetActorLocation(), SimProxyTargetLocation, DeltaSeconds, XRAvatarTuning.SimProxyInterpSpeed);
        const FRotator NewRot = FMath::RInterpTo(GetActorRotation(), SimProxyTargetRotation, DeltaSeconds, XRAvatarTuning.SimProxyInterpSpeed);
        SetActorLocationAndRotation(NewLoc, NewRot, false, nullptr, ETeleportType::None);
    }

    if (HasAuthority() && !IsLocallyControlled() && bHasServerSmoothTarget)
    {
        const FVector SmoothedLoc = FMath::VInterpTo(GetActorLocation(), ServerSmoothTargetLocation, DeltaSeconds, XRAvatarTuning.SimProxyInterpSpeed);
        SetActorLocation(SmoothedLoc, false, nullptr, ETeleportType::None);
    }

    ComputeLocomotion(DeltaSeconds);

    if (HasAuthority())
    {
        EvolveBodyYaw(DeltaSeconds);
        SetMotionState(GetSpeed() > 10.0f ? EUEHperXRAvatarMotionState::Moving : EUEHperXRAvatarMotionState::Idle);
    }
}

void AUEHperXRAvatarPawn::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);

    DOREPLIFETIME(AUEHperXRAvatarPawn, RemoteHeadYaw);
    DOREPLIFETIME(AUEHperXRAvatarPawn, RemoteHeadPitch);
    DOREPLIFETIME(AUEHperXRAvatarPawn, BodyYaw);
    DOREPLIFETIME(AUEHperXRAvatarPawn, AimYaw);
    DOREPLIFETIME(AUEHperXRAvatarPawn, AimPitch);
    DOREPLIFETIME(AUEHperXRAvatarPawn, LeftHandIntent);
    DOREPLIFETIME(AUEHperXRAvatarPawn, RightHandIntent);
    DOREPLIFETIME(AUEHperXRAvatarPawn, MotionState);
}

void AUEHperXRAvatarPawn::OnRep_ReplicatedMovement()
{
    if (IsLocallyControlled())
    {
        return;
    }

    const FRepMovement& RepMove = GetReplicatedMovement();
    SimProxyTargetLocation = RepMove.Location;
    SimProxyTargetRotation = RepMove.Rotation;
    bHasSimProxyTarget = true;
}

void AUEHperXRAvatarPawn::SetHandIntent(EUEHperXRAvatarHandIntent LeftIntent, EUEHperXRAvatarHandIntent RightIntent)
{
    if (HasAuthority())
    {
        LeftHandIntent = LeftIntent;
        RightHandIntent = RightIntent;
        HandleHandIntentChanged();
    }
    else if (IsLocallyControlled())
    {
        ServerSetHandIntent(LeftIntent, RightIntent);
    }
}

void AUEHperXRAvatarPawn::ServerSetHandIntent_Implementation(EUEHperXRAvatarHandIntent LeftIntent, EUEHperXRAvatarHandIntent RightIntent)
{
    LeftHandIntent = LeftIntent;
    RightHandIntent = RightIntent;
    HandleHandIntentChanged();
}

void AUEHperXRAvatarPawn::SetMotionState(EUEHperXRAvatarMotionState NewState)
{
    if (MotionState == NewState)
    {
        return;
    }

    const EUEHperXRAvatarMotionState OldState = MotionState;
    MotionState = NewState;
    OnMotionStateChanged.Broadcast(this, OldState, NewState);
    HandleMotionStateChanged(OldState, NewState);
}

void AUEHperXRAvatarPawn::ServerUpdateXRAvatarPose_Implementation(FVector NewLocation, float NewHeadYaw, float NewHeadPitch, float NewAimYaw, float NewAimPitch)
{
    const float Dist = FVector::Dist(GetActorLocation(), NewLocation);
    if (Dist > XRAvatarTuning.MaxClientMoveDelta)
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperXRAvatar] rejected large client move %.0f cm by %s"), Dist, *GetNameSafe(this));
        return;
    }

    ServerSmoothTargetLocation = NewLocation;
    if (!bHasServerSmoothTarget || Dist > XRAvatarTuning.ServerSnapDistance)
    {
        SetActorLocation(NewLocation, false, nullptr, ETeleportType::None);
    }
    bHasServerSmoothTarget = true;

    RemoteHeadYaw = NewHeadYaw;
    RemoteHeadPitch = FMath::ClampAngle(NewHeadPitch, -XRAvatarTuning.MaxHeadPitch, XRAvatarTuning.MaxHeadPitch);
    AimYaw = NewAimYaw;
    AimPitch = FMath::ClampAngle(NewAimPitch, -XRAvatarTuning.MaxAimPitch, XRAvatarTuning.MaxAimPitch);
    RefreshRemotePosePresentation();
    HandleRemotePoseUpdated();
}

void AUEHperXRAvatarPawn::OnRep_RemoteHeadPose()
{
    RefreshRemotePosePresentation();
    HandleRemotePoseUpdated();
}

void AUEHperXRAvatarPawn::OnRep_BodyYaw()
{
    ApplyBodyYawToMesh();
    RefreshRemotePosePresentation();
    HandleRemotePoseUpdated();
}

void AUEHperXRAvatarPawn::OnRep_MotionState()
{
    HandleMotionStateChanged(PrevMotionState, MotionState);
    PrevMotionState = MotionState;
}

void AUEHperXRAvatarPawn::HandleRemotePoseUpdated_Implementation()
{
}

void AUEHperXRAvatarPawn::HandleHandIntentChanged_Implementation()
{
}

void AUEHperXRAvatarPawn::HandleMotionStateChanged_Implementation(EUEHperXRAvatarMotionState OldState, EUEHperXRAvatarMotionState NewState)
{
}

void AUEHperXRAvatarPawn::GetLocalAimPose_Implementation(float& OutAimYaw, float& OutAimPitch) const
{
    OutAimYaw = BodyYaw;
    OutAimPitch = 0.0f;
}

void AUEHperXRAvatarPawn::SyncPawnToHMD()
{
    if (!VROrigin)
    {
        return;
    }

    FTransform HeadPose;
    if (!ResolveLocalHeadPose(HeadPose))
    {
        return;
    }

    const FVector HeadWorld = HeadPose.GetLocation();
    const FVector RootWorld = GetActorLocation();
    const FVector DiffXY(HeadWorld.X - RootWorld.X, HeadWorld.Y - RootWorld.Y, 0.0f);
    if (DiffXY.IsNearlyZero(0.01f))
    {
        return;
    }

    AddActorWorldOffset(DiffXY, false, nullptr, ETeleportType::None);
    VROrigin->AddWorldOffset(-DiffXY, false, nullptr, ETeleportType::None);
}

void AUEHperXRAvatarPawn::SyncClientXRAvatarPoseToServer()
{
    if (!IsLocallyControlled() || HasAuthority())
    {
        return;
    }

    UWorld* World = GetWorld();
    if (!World)
    {
        return;
    }

    const float Now = World->GetTimeSeconds();
    if (Now - LastServerUpdateTime < XRAvatarTuning.MinServerUpdateInterval)
    {
        return;
    }

    FTransform HeadPose;
    if (!ResolveLocalHeadPose(HeadPose))
    {
        return;
    }

    float LocalAimYaw = 0.0f;
    float LocalAimPitch = 0.0f;
    GetLocalAimPose(LocalAimYaw, LocalAimPitch);

    const FVector CurrentLocation = GetActorLocation();
    const FRotator HeadRot = HeadPose.GetRotation().Rotator();
    const float CurrentHeadYaw = HeadRot.Yaw;
    const float CurrentHeadPitch = FMath::ClampAngle(HeadRot.Pitch, -XRAvatarTuning.MaxHeadPitch, XRAvatarTuning.MaxHeadPitch);

    const float LocDist = FVector::Dist(CurrentLocation, LastServerReportedLocation);
    const float HeadYawDiff = FMath::Abs(FRotator::NormalizeAxis(CurrentHeadYaw - LastServerReportedHeadYaw));
    const float AimYawDiff = FMath::Abs(FRotator::NormalizeAxis(LocalAimYaw - LastServerReportedAimYaw));
    if (LocDist < XRAvatarTuning.MinPositionDelta && HeadYawDiff < XRAvatarTuning.MinHeadYawDelta && AimYawDiff < XRAvatarTuning.MinHeadYawDelta)
    {
        return;
    }

    LastServerUpdateTime = Now;
    LastServerReportedLocation = CurrentLocation;
    LastServerReportedHeadYaw = CurrentHeadYaw;
    LastServerReportedAimYaw = LocalAimYaw;
    ServerUpdateXRAvatarPose(CurrentLocation, CurrentHeadYaw, CurrentHeadPitch, LocalAimYaw, LocalAimPitch);
}

void AUEHperXRAvatarPawn::UpdateLocalHeadPose()
{
    if (!HasAuthority())
    {
        return;
    }

    FTransform HeadPose;
    if (!ResolveLocalHeadPose(HeadPose))
    {
        return;
    }

    const FRotator HeadRot = HeadPose.GetRotation().Rotator();
    const float HeadYaw = HeadRot.Yaw;
    const float HeadPitch = FMath::ClampAngle(HeadRot.Pitch, -XRAvatarTuning.MaxHeadPitch, XRAvatarTuning.MaxHeadPitch);

    float LocalAimYaw = 0.0f;
    float LocalAimPitch = 0.0f;
    GetLocalAimPose(LocalAimYaw, LocalAimPitch);
    AimYaw = LocalAimYaw;
    AimPitch = FMath::ClampAngle(LocalAimPitch, -XRAvatarTuning.MaxAimPitch, XRAvatarTuning.MaxAimPitch);

    if (FMath::Abs(FRotator::NormalizeAxis(HeadYaw - RemoteHeadYaw)) > XRAvatarTuning.MinHeadYawDelta
        || FMath::Abs(FRotator::NormalizeAxis(HeadPitch - RemoteHeadPitch)) > XRAvatarTuning.MinHeadYawDelta)
    {
        RemoteHeadYaw = HeadYaw;
        RemoteHeadPitch = HeadPitch;
        RefreshRemotePosePresentation();
        HandleRemotePoseUpdated();
    }
}

void AUEHperXRAvatarPawn::EvolveBodyYaw(float DeltaSeconds)
{
    if (DeltaSeconds <= 0.0f)
    {
        return;
    }

    const FVector CurLoc = GetActorLocation();
    if (!bHasServerYawSample)
    {
        ServerLastBodyYawSampleLoc = CurLoc;
        bHasServerYawSample = true;
        return;
    }

    const FVector DeltaPos = CurLoc - ServerLastBodyYawSampleLoc;
    ServerLastBodyYawSampleLoc = CurLoc;
    const FVector PlanarVel(DeltaPos.X / DeltaSeconds, DeltaPos.Y / DeltaSeconds, 0.0f);
    const float PlanarSpeed = PlanarVel.Size();

    const float CurBodyYaw = BodyYaw;
    float NewBodyYaw = CurBodyYaw;

    if (PlanarSpeed > XRAvatarTuning.BodyMoveSpeedThreshold)
    {
        const float DesiredYaw = PlanarVel.Rotation().Yaw;
        NewBodyYaw = FMath::RInterpTo(FRotator(0.0f, CurBodyYaw, 0.0f), FRotator(0.0f, DesiredYaw, 0.0f), DeltaSeconds, XRAvatarTuning.BodyMoveTurnSpeed).Yaw;
    }
    else
    {
        const float Delta = FRotator::NormalizeAxis(RemoteHeadYaw - CurBodyYaw);
        const float AbsDelta = FMath::Abs(Delta);
        if (AbsDelta > XRAvatarTuning.BodyTurnDeadzone)
        {
            const float Overshoot = AbsDelta - XRAvatarTuning.BodyTurnDeadzone;
            const float Step = FMath::Min(Overshoot, XRAvatarTuning.BodyIdleTurnSpeed * DeltaSeconds);
            NewBodyYaw = CurBodyYaw + FMath::Sign(Delta) * Step;
        }
    }

    if (!FMath::IsNearlyEqual(NewBodyYaw, CurBodyYaw, 0.01f))
    {
        BodyYaw = FRotator::NormalizeAxis(NewBodyYaw);
        ApplyBodyYawToMesh();
        RefreshRemotePosePresentation();
        HandleRemotePoseUpdated();
    }
}

void AUEHperXRAvatarPawn::ComputeLocomotion(float DeltaSeconds)
{
    if (DeltaSeconds <= 0.0f)
    {
        return;
    }

    const FVector CurLoc = GetActorLocation();
    const float CurBodyYaw = BodyYaw;

    if (!bHasLocoSample)
    {
        LocoLastSampleLoc = CurLoc;
        LocoLastBodyYaw = CurBodyYaw;
        bHasLocoSample = true;
        return;
    }

    const FVector DeltaPos = CurLoc - LocoLastSampleLoc;
    LocoLastSampleLoc = CurLoc;
    const FVector PlanarVel(DeltaPos.X / DeltaSeconds, DeltaPos.Y / DeltaSeconds, 0.0f);
    const float RawSpeed = PlanarVel.Size();
    LocomotionSpeed = FMath::FInterpTo(LocomotionSpeed, RawSpeed, DeltaSeconds, 10.0f);

    if (RawSpeed > KINDA_SMALL_NUMBER)
    {
        LocomotionDirection = FRotator::NormalizeAxis(PlanarVel.Rotation().Yaw - CurBodyYaw);
    }
    else
    {
        LocomotionDirection = 0.0f;
    }

    const float YawDelta = FRotator::NormalizeAxis(CurBodyYaw - LocoLastBodyYaw);
    LocoLastBodyYaw = CurBodyYaw;
    BodyYawSpeed = YawDelta / DeltaSeconds;
}

void AUEHperXRAvatarPawn::RefreshRemotePosePresentation()
{
    RemoteUpperBodyAimYaw = FMath::Clamp(
        FRotator::NormalizeAxis(RemoteHeadYaw - BodyYaw),
        -XRAvatarTuning.MaxUpperBodyAimYaw,
        XRAvatarTuning.MaxUpperBodyAimYaw);
}

void AUEHperXRAvatarPawn::ApplyBodyYawToMesh()
{
    if (!AvatarMesh)
    {
        return;
    }

    const float RootYaw = GetActorRotation().Yaw;
    const float RelativeYaw = FRotator::NormalizeAxis(BodyYaw - RootYaw - 90.0f);
    AvatarMesh->SetRelativeRotation(FRotator(0.0f, RelativeYaw, 0.0f));
}

bool AUEHperXRAvatarPawn::ResolveLocalHeadPose(FTransform& OutHeadWorldTransform) const
{
    if (GetClass()->ImplementsInterface(UUEHperXRLocalPoseProvider::StaticClass()))
    {
        if (IUEHperXRLocalPoseProvider::Execute_GetHeadPose(this, OutHeadWorldTransform))
        {
            return true;
        }
    }

    if (CameraComponent)
    {
        OutHeadWorldTransform = CameraComponent->GetComponentTransform();
        return true;
    }

    return false;
}
