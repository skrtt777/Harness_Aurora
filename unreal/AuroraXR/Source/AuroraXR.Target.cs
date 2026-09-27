using UnrealBuildTool;
public class AuroraXRTarget : TargetRules
{
    public AuroraXRTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.AddRange(new[] { "AuroraXR", "AuroraPassthrough" });
    }
}
