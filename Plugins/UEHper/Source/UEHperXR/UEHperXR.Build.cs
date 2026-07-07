using UnrealBuildTool;

public class UEHperXR : ModuleRules
{
    public UEHperXR(ReadOnlyTargetRules Target)
        : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(
            new string[] { "Core", "CoreUObject", "Engine", "UMG", "HeadMountedDisplay", "UEHper" }
        );

        PrivateDependencyModuleNames.AddRange(new string[] { "Slate", "SlateCore" });
    }
}
