#include "UEHperXRPicoAvatarPawn.h"

#include "PXR_HandComponent.h"
#include "UObject/ConstructorHelpers.h"

static void PopulateUEHperPicoDefaultBoneMappings(TMap<EPICOXRHandJoint, FName>& Out, const TCHAR* Prefix)
{
    const TCHAR* FingerNames[] = {
        TEXT("palm"), TEXT("wrist"),
        TEXT("thumb_metacarpal"), TEXT("thumb_proximal"), TEXT("thumb_distal"), TEXT("thumb_tip"),
        TEXT("index_metacarpal"), TEXT("index_proximal"), TEXT("index_intermediate"), TEXT("index_distal"), TEXT("index_tip"),
        TEXT("middle_metacarpal"), TEXT("middle_proximal"), TEXT("middle_intermediate"), TEXT("middle_distal"), TEXT("middle_tip"),
        TEXT("ring_metacarpal"), TEXT("ring_proximal"), TEXT("ring_intermediate"), TEXT("ring_distal"), TEXT("ring_tip"),
        TEXT("little_metacarpal"), TEXT("little_proximal"), TEXT("little_intermediate"), TEXT("little_distal"), TEXT("little_tip")
    };
    for (int32 i = 0; i < 26; i++)
    {
        Out.Add(static_cast<EPICOXRHandJoint>(i), FName(FString::Printf(TEXT("%s%s"), Prefix, FingerNames[i])));
    }
}

AUEHperXRPicoAvatarPawn::AUEHperXRPicoAvatarPawn()
{
    LeftHand = CreateDefaultSubobject<UPICOXRHandComponent>(TEXT("BP_XRHandComponent_Left"));
    LeftHand->SetupAttachment(VROrigin);
    LeftHand->SetOnlyOwnerSee(true);
    InitPicoHandComponent(LeftHand, EPICOXRHandType::HandLeft, CustomLeftHandMesh, CustomLeftHandBoneMappings);

    RightHand = CreateDefaultSubobject<UPICOXRHandComponent>(TEXT("BP_XRHandComponent_Right"));
    RightHand->SetupAttachment(VROrigin);
    RightHand->SetOnlyOwnerSee(true);
    InitPicoHandComponent(RightHand, EPICOXRHandType::HandRight, CustomRightHandMesh, CustomRightHandBoneMappings);
}

USceneComponent* AUEHperXRPicoAvatarPawn::GetLeftHandSceneComponent() const
{
    return LeftHand;
}

USceneComponent* AUEHperXRPicoAvatarPawn::GetRightHandSceneComponent() const
{
    return RightHand;
}

void AUEHperXRPicoAvatarPawn::BeginPlay()
{
    Super::BeginPlay();

    if (IsLocallyControlled() && !UPICOXRInputFunctionLibrary::IsHandTrackingEnabled())
    {
        UE_LOG(LogTemp, Warning, TEXT("[UEHperXRPico] Hand tracking is currently disabled. Check PICOXRSettings.HandTrackingSupport=ControllersAndHands; VR Preview may enable it shortly after BeginPlay."));
    }
}

void AUEHperXRPicoAvatarPawn::GetLocalAimPose_Implementation(float& OutAimYaw, float& OutAimPitch) const
{
    if (RightHand)
    {
        const FRotator HandRot = RightHand->GetComponentRotation();
        OutAimYaw = HandRot.Yaw;
        OutAimPitch = FMath::ClampAngle(HandRot.Pitch, -XRAvatarTuning.MaxAimPitch, XRAvatarTuning.MaxAimPitch);
        return;
    }

    Super::GetLocalAimPose_Implementation(OutAimYaw, OutAimPitch);
}

void AUEHperXRPicoAvatarPawn::InitPicoHandComponent(UPICOXRHandComponent* Hand, EPICOXRHandType HandType,
                                                    USkeletalMesh* CustomMesh,
                                                    const TMap<EPICOXRHandJoint, FName>& CustomMappings)
{
    Hand->SkeletonType = HandType;

    const bool bIsLeft = HandType == EPICOXRHandType::HandLeft;
    if (CustomMesh)
    {
        Hand->SetSkinnedAssetAndUpdate(CustomMesh);
    }
    else
    {
        const TCHAR* DefaultMeshPath = bIsLeft
            ? TEXT("/PICOXR/Meshes/Hand/LeftHand/SM_Hand_L.SM_Hand_L")
            : TEXT("/PICOXR/Meshes/Hand/RightHand/SM_Hand_R.SM_Hand_R");
        ConstructorHelpers::FObjectFinder<USkeletalMesh> DefaultMeshRef(DefaultMeshPath);
        if (DefaultMeshRef.Succeeded())
        {
            Hand->SetSkinnedAssetAndUpdate(DefaultMeshRef.Object);
        }
    }

    if (!CustomMappings.IsEmpty())
    {
        for (const TPair<EPICOXRHandJoint, FName>& Pair : CustomMappings)
        {
            Hand->BoneNameMappings.Add(Pair.Key, Pair.Value);
        }
    }
    else
    {
        PopulateUEHperPicoDefaultBoneMappings(Hand->BoneNameMappings, bIsLeft ? TEXT("left_") : TEXT("right_"));
    }
}
