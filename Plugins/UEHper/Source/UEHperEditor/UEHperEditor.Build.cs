using UnrealBuildTool;

public class UEHperEditor : ModuleRules
{
    public UEHperEditor(ReadOnlyTargetRules Target)
        : base(Target)
    {
        PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(
            new string[] { "Core", "CoreUObject", "Engine", "UEHper", }
        );

        PrivateDependencyModuleNames.AddRange(
            new string[]
            {
                "AssetRegistry",
                "ContentBrowser",
                "ContentBrowserData",
                "Json",
                "Projects",
                "Slate",
                "SlateCore",
                "ToolMenus",
                "UnrealEd",
            }
        );
    }
}
