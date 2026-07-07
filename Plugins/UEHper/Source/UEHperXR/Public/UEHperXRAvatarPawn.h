#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "UEHperXRAvatarTypes.h"
#include "UEHperXRAvatarPawn.generated.h"

class UCameraComponent;
class UCapsuleComponent;
class USceneComponent;
class USkeletalMeshComponent;
class UWidgetComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FUEHperXRAvatarMotionStateChanged, AUEHperXRAvatarPawn*, Avatar, EUEHperXRAvatarMotionState, OldState, EUEHperXRAvatarMotionState, NewState);

UCLASS(Blueprintable)
class UEHPERXR_API AUEHperXRAvatarPawn : public APawn
{
    GENERATED_BODY()

public:
    AUEHperXRAvatarPawn();

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR")
    TObjectPtr<UCapsuleComponent> CollisionCylinder;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR")
    TObjectPtr<USceneComponent> VROrigin;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR")
    TObjectPtr<USkeletalMeshComponent> AvatarMesh;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR")
    TObjectPtr<UCameraComponent> CameraComponent;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    TObjectPtr<UWidgetComponent> NameplateWidget;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR")
    FUEHperXRAvatarTuning XRAvatarTuning;

    UPROPERTY(ReplicatedUsing = OnRep_RemoteHeadPose, VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float RemoteHeadYaw = 0.0f;

    UPROPERTY(ReplicatedUsing = OnRep_RemoteHeadPose, VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float RemoteHeadPitch = 0.0f;

    UPROPERTY(ReplicatedUsing = OnRep_BodyYaw, VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float BodyYaw = 0.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float RemoteUpperBodyAimYaw = 0.0f;

    UPROPERTY(Replicated, VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float AimYaw = 0.0f;

    UPROPERTY(Replicated, VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    float AimPitch = 0.0f;

    UPROPERTY(Replicated, VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    EUEHperXRAvatarHandIntent LeftHandIntent = EUEHperXRAvatarHandIntent::Open;

    UPROPERTY(Replicated, VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Remote")
    EUEHperXRAvatarHandIntent RightHandIntent = EUEHperXRAvatarHandIntent::Open;

    UPROPERTY(ReplicatedUsing = OnRep_MotionState, VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Anim")
    EUEHperXRAvatarMotionState MotionState = EUEHperXRAvatarMotionState::Idle;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|Anim")
    EUEHperXRAvatarMotionState PrevMotionState = EUEHperXRAvatarMotionState::Idle;

    UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Anim")
    float LocomotionSpeed = 0.0f;

    UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Anim")
    float LocomotionDirection = 0.0f;

    UPROPERTY(VisibleInstanceOnly, BlueprintReadOnly, Category = "UEHper|XR|Anim")
    float BodyYawSpeed = 0.0f;

    UPROPERTY(BlueprintAssignable, Category = "UEHper|XR")
    FUEHperXRAvatarMotionStateChanged OnMotionStateChanged;

    UFUNCTION(BlueprintCallable, Category = "UEHper|XR")
    void SetHandIntent(EUEHperXRAvatarHandIntent LeftIntent, EUEHperXRAvatarHandIntent RightIntent);

    UFUNCTION(Server, Reliable, Category = "UEHper|XR")
    void ServerSetHandIntent(EUEHperXRAvatarHandIntent LeftIntent, EUEHperXRAvatarHandIntent RightIntent);

    UFUNCTION(BlueprintCallable, Category = "UEHper|XR")
    void SetMotionState(EUEHperXRAvatarMotionState NewState);

    UFUNCTION(BlueprintPure, Category = "UEHper|XR")
    float GetBodyYaw() const { return BodyYaw; }

    UFUNCTION(BlueprintPure, Category = "UEHper|XR")
    float GetSpeed() const { return LocomotionSpeed; }

    virtual void Tick(float DeltaSeconds) override;
    virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
    virtual void OnRep_ReplicatedMovement() override;

protected:
    virtual void BeginPlay() override;

    UFUNCTION(Server, Unreliable, Category = "UEHper|XR")
    void ServerUpdateXRAvatarPose(FVector NewLocation, float NewHeadYaw, float NewHeadPitch, float NewAimYaw, float NewAimPitch);

    UFUNCTION()
    void OnRep_RemoteHeadPose();

    UFUNCTION()
    void OnRep_BodyYaw();

    UFUNCTION()
    void OnRep_MotionState();

    UFUNCTION(BlueprintNativeEvent, Category = "UEHper|XR")
    void HandleRemotePoseUpdated();

    UFUNCTION(BlueprintNativeEvent, Category = "UEHper|XR")
    void HandleHandIntentChanged();

    UFUNCTION(BlueprintNativeEvent, Category = "UEHper|XR")
    void HandleMotionStateChanged(EUEHperXRAvatarMotionState OldState, EUEHperXRAvatarMotionState NewState);

    UFUNCTION(BlueprintNativeEvent, Category = "UEHper|XR")
    void GetLocalAimPose(float& OutAimYaw, float& OutAimPitch) const;

    void SyncPawnToHMD();
    void SyncClientXRAvatarPoseToServer();
    void UpdateLocalHeadPose();
    void EvolveBodyYaw(float DeltaSeconds);
    void ComputeLocomotion(float DeltaSeconds);
    void RefreshRemotePosePresentation();
    void ApplyBodyYawToMesh();

    bool ResolveLocalHeadPose(FTransform& OutHeadWorldTransform) const;

private:
    FVector LastServerReportedLocation = FVector::ZeroVector;
    float LastServerReportedHeadYaw = 0.0f;
    float LastServerReportedAimYaw = 0.0f;
    float LastServerUpdateTime = 0.0f;

    FVector SimProxyTargetLocation = FVector::ZeroVector;
    FRotator SimProxyTargetRotation = FRotator::ZeroRotator;
    bool bHasSimProxyTarget = false;

    FVector ServerSmoothTargetLocation = FVector::ZeroVector;
    bool bHasServerSmoothTarget = false;

    FVector ServerLastBodyYawSampleLoc = FVector::ZeroVector;
    bool bHasServerYawSample = false;
    FVector LocoLastSampleLoc = FVector::ZeroVector;
    float LocoLastBodyYaw = 0.0f;
    bool bHasLocoSample = false;
};
