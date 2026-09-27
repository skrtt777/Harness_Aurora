import unreal

path='/Game/Aurora/Materials/M_AuroraPresence'
material=unreal.load_asset(path)
if not material:
    material=unreal.AssetToolsHelpers.get_asset_tools().create_asset('M_AuroraPresence','/Game/Aurora/Materials',unreal.Material,unreal.MaterialFactoryNew())
    material.set_editor_property('shading_model',unreal.MaterialShadingModel.MSM_UNLIT)
    color=unreal.MaterialEditingLibrary.create_material_expression(material,unreal.MaterialExpressionVectorParameter,-250,0)
    color.set_editor_property('parameter_name','Tint')
    color.set_editor_property('default_value',unreal.LinearColor(0.05,1.0,0.8,1))
    unreal.MaterialEditingLibrary.connect_material_property(color,'',unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    unreal.MaterialEditingLibrary.recompile_material(material)
    unreal.EditorAssetLibrary.save_loaded_asset(material)
unreal.log('Aurora Presence material ready')
