"""Run inside Unreal Editor. Creates the initial Aurora workspace once."""
import unreal

MAP = '/Game/Aurora/Maps/L_AuroraWorkspace'
assets = unreal.EditorAssetLibrary
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
if assets.does_asset_exist(MAP):
    raise RuntimeError('Workspace already exists; refusing to replace edited content')
if not levels.save_all_dirty_levels():
    raise RuntimeError('Could not save current levels')
assets.make_directory('/Game/Aurora/Maps')
assets.make_directory('/Game/Aurora/Materials')
if not levels.new_level_from_template(MAP, '/Game/XRFramework/Levels/L_XRTemplate'):
    raise RuntimeError('Could not create workspace')

def material(name, rgb, emissive=False):
    path = '/Game/Aurora/Materials/' + name
    if assets.does_asset_exist(path):
        return assets.load_asset(path)
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, '/Game/Aurora/Materials', unreal.Material, unreal.MaterialFactoryNew())
    color = unreal.MaterialEditingLibrary.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector)
    color.set_editor_property('constant', unreal.LinearColor(*rgb, 1.0))
    unreal.MaterialEditingLibrary.connect_material_property(color, '', unreal.MaterialProperty.MP_BASE_COLOR)
    if emissive:
        unreal.MaterialEditingLibrary.connect_material_property(color, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    rough = unreal.MaterialEditingLibrary.create_material_expression(mat, unreal.MaterialExpressionConstant)
    rough.set_editor_property('r', 0.65)
    unreal.MaterialEditingLibrary.connect_material_property(rough, '', unreal.MaterialProperty.MP_ROUGHNESS)
    unreal.MaterialEditingLibrary.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat

floor_mat = material('M_AuroraFloor', (0.025, 0.04, 0.065))
wall_mat = material('M_AuroraWall', (0.075, 0.105, 0.15))
panel_mat = material('M_AuroraPanel', (0.012, 0.022, 0.042))
cyan = material('M_AuroraCyan', (0.04, 0.8, 0.75), True)
violet = material('M_AuroraViolet', (0.45, 0.2, 0.8), True)

world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
persistent_path = world.get_path_name() + ':PersistentLevel'
for actor in list(actors.get_all_level_actors()):
    if actor.get_outer().get_path_name() != persistent_path:
        continue
    label = actor.get_actor_label()
    if label.startswith('Cube') or label.startswith('BP_Pistol') or label in ('SM_Ball_01', 'Fire_Cue', 'TextRenderActor', 'Wall_4', 'Wall_5', 'Wall_6', 'Roof', 'NavModifier_NoTeleport'):
        actors.destroy_actor(actor)
        continue
    if isinstance(actor, unreal.StaticMeshActor):
        mesh = actor.static_mesh_component
        if label in ('Floor', 'Table') or label.startswith('Wall_'):
            for slot in range(mesh.get_num_materials()):
                mesh.set_material(slot, floor_mat if label == 'Floor' else wall_mat)

def cube(label, pos, scale, mat):
    actor = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*pos))
    actor.set_actor_label(label)
    actor.set_folder_path('Aurora/Architecture')
    actor.static_mesh_component.set_static_mesh(assets.load_asset('/Engine/BasicShapes/Cube'))
    actor.static_mesh_component.set_material(0, mat)
    actor.set_actor_scale3d(unreal.Vector(*scale))
    return actor

def text(label, value, pos, size=16, color=(220, 235, 255)):
    actor = actors.spawn_actor_from_class(unreal.TextRenderActor, unreal.Vector(*pos), unreal.Rotator(pitch=0, yaw=180, roll=0))
    actor.set_actor_label(label)
    actor.set_folder_path('Aurora/Signage')
    component = actor.get_component_by_class(unreal.TextRenderComponent)
    component.set_text(value)
    component.set_world_size(size)
    component.set_horizontal_alignment(unreal.HorizTextAligment.EHTA_CENTER)
    component.set_text_render_color(unreal.Color(*color, 255))
    return actor

cube('Aurora_Backdrop', (465, 0, 220), (0.15, 10, 4.4), wall_mat)
text('Aurora_Title', 'A U R O R A', (425, 0, 330), 42)
text('Aurora_Subtitle', 'SEU ESPACO DE INTELIGENCIA', (424, 0, 295), 12, (80, 225, 215))
for y, title, subtitle, accent in [(-300, 'CONVERSA', 'Interface espacial\nConexao com IA em breve', cyan), (0, 'MEMORIA', 'Contexto e conhecimento\nPainel em preparacao', violet), (300, 'CONTROLES', 'Explore o ambiente\nTeste os cubos na mesa', cyan)]:
    cube('Aurora_Panel_' + title, (440, y, 185), (0.12, 2.6, 1.8), panel_mat)
    cube('Aurora_Accent_' + title, (432, y, 272), (0.04, 2.6, 0.035), accent)
    text('Aurora_Heading_' + title, title, (431, y, 238), 21)
    text('Aurora_Body_' + title, subtitle, (431, y, 194), 12)
    text('Aurora_Status_' + title, 'PROTOTIPO LOCAL', (431, y, 124), 9, (80, 225, 215))
for y in (-460, 460):
    cube('Aurora_FloorGuide', (0, y, 1), (8.7, 0.045, 0.015), cyan)
text('Aurora_InteractionHint', 'LABORATORIO XR', (200, 0, 125), 14, (80, 225, 215))

lighting_path = '/Game/Aurora/Maps/L_AuroraLighting'
assert assets.duplicate_asset('/Game/XRFramework/Levels/L_XRTemplate_Lighting', lighting_path)
old_lighting = next(a.get_outer() for a in actors.get_all_level_actors() if a.get_actor_label() == 'DirectionalLight')
assert unreal.EditorLevelUtils.remove_level_from_world(old_lighting)
assert unreal.EditorLevelUtils.add_level_to_world(world, lighting_path, unreal.LevelStreamingAlwaysLoaded)
world.get_world_settings().set_editor_property('force_no_precomputed_lighting', True)
for actor in actors.get_all_level_actors():
    if actor.get_outer().get_path_name().startswith(lighting_path + '.'):
        for light in actor.get_components_by_class(unreal.LightComponentBase):
            light.set_mobility(unreal.ComponentMobility.MOVABLE)

# Keep template assets intact; use non-Nanite copies for the forward VR renderer.
assets.make_directory('/Game/Aurora/Meshes')
sm_editor = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
mesh_copies = {}
for actor in actors.get_all_level_actors():
    if actor.get_outer().get_path_name() != persistent_path:
        continue
    for component in actor.get_components_by_class(unreal.StaticMeshComponent):
        mesh = component.static_mesh
        if not mesh or not sm_editor.get_nanite_settings(mesh).enabled:
            continue
        source = mesh.get_path_name()
        if source not in mesh_copies:
            target = '/Game/Aurora/Meshes/' + mesh.get_name() + '_VR'
            copy = assets.load_asset(target) if assets.does_asset_exist(target) else assets.duplicate_asset(source, target)
            settings = sm_editor.get_nanite_settings(copy)
            settings.enabled = False
            sm_editor.set_nanite_settings(copy, settings)
            assets.save_loaded_asset(copy)
            mesh_copies[source] = copy
        component.set_static_mesh(mesh_copies[source])

unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).set_level_viewport_camera_info(unreal.Vector(-380, 0, 180), unreal.Rotator(0, 0, 0))
actors.set_selected_level_actors([])
levels.editor_set_game_view(True)
if not levels.save_all_dirty_levels():
    raise RuntimeError('Workspace save failed')
assets.save_directory('/Game/Aurora', only_if_is_dirty=True, recursive=True)
print('AURORA_WORKSPACE_CREATED=' + MAP)
