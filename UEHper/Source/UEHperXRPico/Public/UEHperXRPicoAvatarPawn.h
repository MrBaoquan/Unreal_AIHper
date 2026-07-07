#pragma once

#include "CoreMinimal.h"
#include "UEHperXRAvatarPawn.h"
#include "PXR_InputFunctionLibrary.h"
#include "UEHperXRPicoAvatarPawn.generated.h"

class UPICOXRHandComponent;

UCLASS(Blueprintable)
class UEHPERXRPICO_API AUEHperXRPicoAvatarPawn : public AUEHperXRAvatarPawn
{
    GENERATED_BODY()

public:
    AUEHperXRPicoAvatarPawn();

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|PICO")
    TObjectPtr<UPICOXRHandComponent> LeftHand;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "UEHper|XR|PICO")
    TObjectPtr<UPICOXRHandComponent> RightHand;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|PICO|Hand")
    TObjectPtr<USkeletalMesh> CustomLeftHandMesh;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|PICO|Hand")
    TObjectPtr<USkeletalMesh> CustomRightHandMesh;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|PICO|Hand")
    TMap<EPICOXRHandJoint, FName> CustomLeftHandBoneMappings;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UEHper|XR|PICO|Hand")
    TMap<EPICOXRHandJoint, FName> CustomRightHandBoneMappings;

    UFUNCTION(BlueprintPure, Category = "UEHper|XR|PICO")
    USceneComponent* GetLeftHandSceneComponent() const;

    UFUNCTION(BlueprintPure, Category = "UEHper|XR|PICO")
    USceneComponent* GetRightHandSceneComponent() const;

protected:
    virtual void BeginPlay() override;
    virtual void GetLocalAimPose_Implementation(float& OutAimYaw, float& OutAimPitch) const override;

    void InitPicoHandComponent(UPICOXRHandComponent* Hand, EPICOXRHandType HandType,
                               USkeletalMesh* CustomMesh,
                               const TMap<EPICOXRHandJoint, FName>& CustomMappings);
};
