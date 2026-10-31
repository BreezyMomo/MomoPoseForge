"""Convert the user-supplied CC0 BodyChan/BodyKun file to standalone FK glTF rigs.

Run with Blender --background --factory-startup --disable-autoexec --python
this_file -- source.blend output_directory. The source file is never saved.
"""
import bpy
import hashlib
import json
import sys
import struct
import tempfile
import math
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion


def islands(mesh):
    adjacency = [set() for _ in mesh.data.vertices]
    for edge in mesh.data.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)
    remaining = set(range(len(adjacency)))
    while remaining:
        seed = remaining.pop()
        part, stack = {seed}, [seed]
        while stack:
            for index in adjacency[stack.pop()] & remaining:
                remaining.remove(index)
                part.add(index)
                stack.append(index)
        yield sorted(part)


def gltf_joints(path, names):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + size])
    parents = {child: i for i, node in enumerate(doc['nodes']) for child in node.get('children', [])}
    worlds = {}
    def world(index):
        if index not in worlds:
            node = doc['nodes'][index]
            q = node.get('rotation', [0, 0, 0, 1])
            local = Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(node.get('scale', [1, 1, 1])))
            worlds[index] = world(parents[index]) @ local if index in parents else local
        return worlds[index]
    return {node['name']: {'position': node.get('translation', [0, 0, 0]), 'world': world(i)} for i, node in enumerate(doc['nodes']) if node.get('name') in names}

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

    # Rigify's knee heads are ~3 cm in front of the actual mechanical balls.
    # Fit the source's closed spherical mesh islands, independently for each leg.
    knee_caps = {}
    for side, short in [('left', 'L'), ('right', 'R')]:
        old = point(original.matrix_world @ original.data.bones[f'DEF-shin.{short}'].head_local)
        candidates = []
        for mesh in meshes:
            for indices in islands(mesh):
                if len(indices) < 100:
                    continue
                positions = np.array([point(mesh.matrix_world @ mesh.data.vertices[i].co)[:] for i in indices])
                low, high = positions.min(axis=0), positions.max(axis=0)
                extent = high - low
                if extent.min() <= .02 or extent.max() / extent.min() > 1.03:
                    continue
                center = np.linalg.lstsq(np.column_stack((2 * positions, np.ones(len(positions)))), (positions * positions).sum(axis=1), rcond=None)[0][:3]
                radius = np.linalg.norm(positions - center, axis=1).mean()
                residual = np.abs(np.linalg.norm(positions - center, axis=1) - radius).max()
                distance = (Vector(center) - old).length
                if distance < .06 and residual < .001:
                    candidates.append((distance, mesh.name, indices, Vector(center), float(radius)))
        assert candidates, f'No knee ball found for {variant}/{side}'
        _, mesh_name, indices, center, radius = min(candidates, key=lambda candidate: candidate[0])
        knee_caps[side] = {'mesh': mesh_name, 'indices': indices, 'center': center, 'radius': radius, 'offset': (center - old).length}

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
    exported_meshes = {}
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
        exported_meshes[src.name] = mesh
        vertex_count += len(mesh.data.vertices)
    # Capture the exact old local translations for an explicit document migration.
    with tempfile.TemporaryDirectory(prefix='poseforge-figure-calibration-') as temporary:
        legacy_path = Path(temporary) / 'legacy.glb'
        bpy.ops.export_scene.gltf(filepath=str(legacy_path), export_format='GLB', export_animations=False, use_active_scene=True, export_yup=True, export_extras=False)
        legacy = gltf_joints(legacy_path, definitions)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    for side, cap in knee_caps.items():
        bone = armature.data.edit_bones[f'{side}_shin']
        delta = cap['center'] - bone.head
        bone.head += delta
        bone.tail += delta  # Translation only: keep the historical FK bind axes.
    bpy.ops.object.mode_set(mode='OBJECT')
    for side, cap in knee_caps.items():
        mesh = exported_meshes[cap['mesh']]
        for group in mesh.vertex_groups:
            group.remove(cap['indices'])
        mesh.vertex_groups[f'{side}_thigh'].add(cap['indices'], 1, 'REPLACE')
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(output / f'{variant}.glb'), export_format='GLB', export_animations=False, use_active_scene=True, export_yup=True, export_extras=False)
    manifest = {'id': f'momo-{variant}-fk', 'version': 1, 'rigVersion': 1, 'units': 'metres', 'sourceSha256': source_hash, 'heightMetres': height, 'sourceVertices': vertex_count, 'conversion': 'Rigify deformation weights collapsed to 53 anatomical FK joints; knee pivots fitted to source spherical joints and knee caps rigidly weighted to thighs; original mesh proportions and FK bind axes retained; plain clay material; no scripts, constraints or animations.'}
    corrected = gltf_joints(output / f'{variant}.glb', definitions)
    changed = [name for name in definitions if (Vector(legacy[name]['position']) - Vector(corrected[name]['position'])).length > .00001]
    assert set(changed) == {'left_shin', 'right_shin', 'left_foot', 'right_foot'}, changed
    hinges, caps = {}, {}
    for side, cap in knee_caps.items():
        thigh, shin, foot = [corrected[f'{side}_{joint}']['world'] for joint in ['thigh', 'shin', 'foot']]
        upper = (shin.translation - thigh.translation).normalized()
        lower = (foot.translation - shin.translation).normalized()
        axis = upper.cross(lower).normalized()
        if axis.x < 0:
            axis.negate()
        bend = math.degrees(math.atan2(axis.dot(upper.cross(lower)), upper.dot(lower)))
        local_axis = shin.to_quaternion().inverted() @ axis
        hinges[f'{side}_shin'] = {'axis': list(local_axis.normalized()), 'min': min(0, -bend), 'max': 150 - bend, 'straight': -bend}
        center = [cap['center'].x, cap['center'].z, -cap['center'].y]
        assert (shin.translation - Vector(center)).length < .00001
        caps[f'{side}_shin'] = {'mesh': cap['mesh'] + '_surface', 'center': center, 'radius': cap['radius'], 'weightJoint': f'{side}_thigh', 'sourcePivotErrorMetres': cap['offset']}
    manifest.update({'rigCalibrationVersion': 1, 'legacyPositions': {name: legacy[name]['position'] for name in changed}, 'kneeHinges': hinges, 'kneeCaps': caps})
    (output / f'{variant}-profile.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'EXPORTED {variant}: {vertex_count} vertices, {len(definitions)} joints, scale={scale}')

