"""Create the empty passthrough scene. Run once inside the editor."""
import unreal

path = '/Game/Aurora/Maps/L_AuroraMR'
assets = unreal.EditorAssetLibrary
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
if assets.does_asset_exist(path):
    levels.load_level(path)
else:
    assert levels.save_all_dirty_levels()
    assert levels.new_level(path)
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    world.get_world_settings().set_editor_property('default_game_mode', unreal.AuroraMRGameMode)
    world.get_world_settings().set_editor_property('force_no_precomputed_lighting', True)
    start = unreal.get_editor_subsystem(unreal.EditorActorSubsystem).spawn_actor_from_class(unreal.PlayerStart, unreal.Vector(0,0,0))
    start.set_actor_label('AuroraMR_Origin')
    assert levels.save_current_level()
unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).set_level_viewport_camera_info(unreal.Vector(0,0,160), unreal.Rotator())
print('MR_MAP_READY=' + path)
