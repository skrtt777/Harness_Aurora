using UnrealBuildTool;
public class AuroraXREditorTarget : TargetRules
{
    public AuroraXREditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_8;
        ExtraModuleNames.AddRange(new[] { "AuroraXR", "AuroraPassthrough" });
    }
}
