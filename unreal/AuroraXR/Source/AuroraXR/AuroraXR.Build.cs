using UnrealBuildTool;
public class AuroraXR : ModuleRules
{
    public AuroraXR(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore", "UMG", "Slate", "SlateCore", "HeadMountedDisplay", "XRBase", "AuroraPassthrough", "HTTP", "Json", "AudioCaptureCore", "AudioCapture", "SSL", "ProceduralMeshComponent" });
        if(Target.Platform==UnrealTargetPlatform.Android) {
            PrivateDependencyModuleNames.AddRange(new[] {"AndroidPermission", "Launch"});
            AdditionalPropertiesForReceipt.Add("AndroidPlugin", System.IO.Path.Combine(ModuleDirectory,"AuroraAndroid_UPL.xml"));
        }
    }
}
