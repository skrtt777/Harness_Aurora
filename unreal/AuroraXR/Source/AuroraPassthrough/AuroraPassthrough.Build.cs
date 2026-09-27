using UnrealBuildTool;
using System.IO;
public class AuroraPassthrough : ModuleRules
{
    public AuroraPassthrough(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "OpenXRHMD" });
        PrivateDependencyModuleNames.AddRange(new[] { "Engine", "HeadMountedDisplay", "AugmentedReality", "RHI", "RenderCore" });
        AddEngineThirdPartyPrivateStaticDependencies(Target, "OpenXR");
        if (Target.Platform == UnrealTargetPlatform.Android)
            AdditionalPropertiesForReceipt.Add("AndroidPlugin", Path.Combine(ModuleDirectory, "AuroraQuest_UPL.xml"));
    }
}
