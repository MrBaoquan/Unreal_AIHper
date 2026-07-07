// Some copyright should be here...

using System.IO;
using UnrealBuildTool;

public class UEHper : ModuleRules
{
    public UEHper(ReadOnlyTargetRules Target)
        : base(Target)
    {
        bool bHasPicoEnterprise = false;
        if (Target.ProjectFile != null)
        {
            string ProjectDir = Path.GetDirectoryName(Target.ProjectFile.FullName);
            if (!string.IsNullOrEmpty(ProjectDir))
            {
                bHasPicoEnterprise = Directory.Exists(
                    Path.Combine(ProjectDir, "Plugins", "PICOEnterprise")
                );
            }
        }

        // PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicIncludePaths.AddRange(
            new string[]
            {
                // ... add public include paths required here ...
            }
        );

        PrivateIncludePaths.AddRange(
            new string[]
            {
                // ... add other private include paths required here ...
            }
        );

        PublicDependencyModuleNames.AddRange(
            new string[]
            {
                "Core",
                "CoreUObject",
                "Engine",
                "AssetRegistry",
                "DeveloperSettings",
                "MovieScene",
                "UMG",
                // ... add other public dependencies that you statically link with here ...
            }
        );

        PrivateDependencyModuleNames.AddRange(
            new string[]
            {
                "CoreUObject",
                "Engine",
                "Json",
                "Slate",
                "SlateCore",
                "JsEnv",
                "Sockets",
                "Networking"
                // ... add private dependencies that you statically link with here ...
            }
        );

        if (bHasPicoEnterprise)
        {
            PrivateDependencyModuleNames.Add("PICOEnterprise");
            PublicDefinitions.Add("UEHPER_WITH_PICO_ENTERPRISE=1");
        }
        else
        {
            PublicDefinitions.Add("UEHPER_WITH_PICO_ENTERPRISE=0");
        }

        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.AddRange(
                new string[] { "AssetTools", "ContentBrowser", "UMGEditor", "UnrealEd" }
            );
        }

        DynamicallyLoadedModuleNames.AddRange(
            new string[]
            {
                // ... add any modules that your module loads dynamically here ...
            }
        );
    }
}
