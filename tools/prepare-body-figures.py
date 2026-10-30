"""Convert the user-supplied CC0 BodyChan/BodyKun file to standalone FK glTF rigs.

Run with Blender --background --factory-startup --disable-autoexec --python
this_file -- source.blend output_directory. The source file is never saved.
"""
import bpy
import hashlib
import json
import sys
from pathlib import Path
from mathutils import Vector

source, output = map(Path, sys.argv[sys.argv.index('--') + 1:])
output.mkdir(parents=True, exist_ok=True)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

for variant, original_name, height in [('bodychan', 'rig', 1.68), ('bodykun', 'body_kun_rig', 1.78)]:
    bpy.ops.wm.open_mainfile(filepath=str(source), use_scripts=False)
    original = bpy.data.objects[original_name]
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.parent == original]
    coords = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    bottom, top = min(p.z for p in coords), max(p.z for p in coords)
    scale = height / (top - bottom)
    def point(p):
        return Vector((p.x * scale, p.y * scale, (p.z - bottom) * scale))

    # Collapse Rigify bendy segments and palm helpers into anatomical FK joints.
    # Preserve source proportions; this is an asset conversion, not an X Bot pose map.
    mapping, definitions = {}, {}
    spine = ['pelvis', 'waist', 'spine', 'chest', 'upper_chest', 'neck', 'head']
    for i, name in enumerate(spine):
        old = 'DEF-spine' + (f'.{i:03d}' if i else '')
        mapping[old] = name
        definitions[name] = (old, spine[i - 1] if i else None)
    for side, short in [('left', 'L'), ('right', 'R')]:
        for old, name, parent in [('shoulder', 'shoulder', 'chest'), ('upper_arm', 'upper_arm', f'{side}_shoulder'), ('forearm', 'forearm', f'{side}_upper_arm'), ('hand', 'hand', f'{side}_forearm'), ('thigh', 'thigh', 'pelvis'), ('shin', 'shin', f'{side}_thigh'), ('foot', 'foot', f'{side}_shin'), ('toe', 'toe', f'{side}_foot')]:
            old_name = f'DEF-{old}.{short}'
            mapping[old_name] = f'{side}_{name}'
            definitions[f'{side}_{name}'] = (old_name, parent)
            if old in ['upper_arm', 'forearm', 'thigh', 'shin']:
                mapping[f'{old_name}.001'] = f'{side}_{name}'
        mapping[f'DEF-pelvis.{short}'] = 'pelvis'
        for i in range(1, 5):
            mapping[f'DEF-palm.{i:02d}.{short}'] = f'{side}_hand'
        for digit, old_digit in [('thumb', 'thumb'), ('index', 'f_index'), ('middle', 'f_middle'), ('ring', 'f_ring'), ('little', 'f_pinky')]:
            for i in range(1, 4):
                name, old = f'{side}_{digit}_{i}', f'DEF-{old_digit}.{i:02d}.{short}'
                mapping[old] = name
                definitions[name] = (old, f'{side}_{digit}_{i-1}' if i > 1 else f'{side}_hand')
    deform = {b.name for b in original.data.bones if b.use_deform}
    assert deform == set(mapping), f'Unexpected deform topology: {deform ^ set(mapping)}'

    # Use an isolated export scene, with no source scripts, drivers or Rigify controllers.
    scene = bpy.data.scenes.new(f'{variant}_export')
    bpy.context.window.scene = scene
    armature = bpy.data.objects.new(f'{variant}_skeleton', bpy.data.armatures.new(f'{variant}_bones'))
    scene.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (old, parent) in definitions.items():
        src = original.data.bones[old]
        bone = armature.data.edit_bones.new(name)
        bone.head, bone.tail = point(original.matrix_world @ src.head_local), point(original.matrix_world @ src.tail_local)
        if (bone.tail - bone.head).length < .00001:
            bone.tail = bone.head + Vector((0, 0, .01))
    for name, (_, parent) in definitions.items():
        if parent:
            armature.data.edit_bones[name].parent = armature.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    material = bpy.data.materials.new(f'{variant}_clay')
    material.use_nodes = True
    node = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = (.58, .56, .52, 1)
    node.inputs['Roughness'].default_value = .8
    vertex_count = 0
    for src in meshes:
        mesh = bpy.data.objects.new(src.name + '_surface', src.data.copy())
        scene.collection.objects.link(mesh)
        for v in mesh.data.vertices:
            v.co = point(src.matrix_world @ v.co)
        mesh.vertex_groups.clear()
        groups = {name: mesh.vertex_groups.new(name=name) for name in definitions}
        source_groups = {g.index: mapping.get(g.name) for g in src.vertex_groups}
        for v in src.data.vertices:
            weights = {}
            for g in v.groups:
                name = source_groups.get(g.group)
                if name and g.weight > 0:
                    weights[name] = weights.get(name, 0) + g.weight
            weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4])
            total = sum(weights.values())
            assert total > 1e-8, f'Unweighted source vertex: {src.name}/{v.index}'
            for name, value in weights.items():
                groups[name].add([v.index], value / total, 'REPLACE')
        mesh.data.materials.clear()
        mesh.data.materials.append(material)
        for face in mesh.data.polygons:
            face.use_smooth = True
        mesh.parent = armature
        modifier = mesh.modifiers.new('FigureSkin', 'ARMATURE')
        modifier.object = armature
        vertex_count += len(mesh.data.vertices)
    bpy.ops.export_scene.gltf(filepath=str(output / f'{variant}.glb'), export_format='GLB', export_animations=False, use_active_scene=True, export_yup=True, export_extras=False)
    manifest = {'id': f'momo-{variant}-fk', 'version': 1, 'rigVersion': 1, 'units': 'metres', 'sourceSha256': source_hash, 'heightMetres': height, 'sourceVertices': vertex_count, 'conversion': 'Rigify deformation weights collapsed to 53 anatomical FK joints; original proportions retained; plain clay material; no scripts, constraints or animations.'}
    (output / f'{variant}-profile.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'EXPORTED {variant}: {vertex_count} vertices, {len(definitions)} joints, scale={scale}')

