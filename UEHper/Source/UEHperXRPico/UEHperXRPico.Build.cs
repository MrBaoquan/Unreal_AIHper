using System.IO;
using UnrealBuildTool;

public class UEHperXRPico : ModuleRules
{
    public UEHperXRPico(ReadOnlyTargetRules Target)
        : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(
            new string[] { "Core", "CoreUObject", "Engine", "UEHperXR" }
        );

        bool bHasPicoXR = false;
        if (Target.ProjectFile != null)
        {
            string ProjectDir = Path.GetDirectoryName(Target.ProjectFile.FullName);
            if (!string.IsNullOrEmpty(ProjectDir))
            {
                bHasPicoXR = Directory.Exists(Path.Combine(ProjectDir, "Plugins", "PICOXR"));
            }
        }

        if (bHasPicoXR)
        {
            PublicDependencyModuleNames.AddRange(new string[] { "PICOXRInput", "PICOXRHMD" });
            PublicDefinitions.Add("UEHPER_WITH_PICO_XR=1");

            if (Target.ProjectFile != null)
            {
                PublicIncludePaths.Add(
                    Path.Combine(
                        Target.ProjectFile.Directory.FullName,
                        "Plugins/PICOXR/Source/PICOXRInput/Private"
                    )
                );
            }
        }
        else
        {
            PublicDefinitions.Add("UEHPER_WITH_PICO_XR=0");
        }
    }
}
