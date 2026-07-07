#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "UEHperXRLocalPoseProvider.generated.h"

UINTERFACE(BlueprintType)
class UEHPERXR_API UUEHperXRLocalPoseProvider : public UInterface
{
    GENERATED_BODY()
};

class UEHPERXR_API IUEHperXRLocalPoseProvider
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "UEHper|XR|Pose")
    bool GetHeadPose(FTransform& OutHeadWorldTransform) const;

    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "UEHper|XR|Pose")
    bool GetLeftHandPose(FTransform& OutLeftHandWorldTransform) const;

    UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "UEHper|XR|Pose")
    bool GetRightHandPose(FTransform& OutRightHandWorldTransform) const;
};
