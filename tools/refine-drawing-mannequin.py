"""Fuse and refine the original blockout into a closed torso with smooth joins.
Background Blender, factory-startup: -- blockout.glb torso.json.gz figure.blend
"""
import bpy
import gzip
import json
import sys
from pathlib import Path
from mathutils import Vector

source, geometry_file, blend_file = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
armature = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
body = bpy.data.objects['Body']
bpy.ops.object.select_all(action='DESELECT')
for name in ['Body', 'Bust', 'Neck']:
    obj = bpy.data.objects[name]
    for modifier in list(obj.modifiers):
        obj.modifiers.remove(modifier)
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.vertex_groups.clear()
body.data.remesh_voxel_size = .0035
body.data.remesh_voxel_adaptivity = 0
bpy.ops.object.voxel_remesh()
smooth = body.modifiers.new('Sculpt surface relaxation', 'SMOOTH')
smooth.factor = .55
smooth.iterations = 4
bpy.ops.object.modifier_apply(modifier=smooth.name)
decimate = body.modifiers.new('Drawing topology reduction', 'DECIMATE')
decimate.ratio = .25
bpy.ops.object.modifier_apply(modifier=decimate.name)
for polygon in body.data.polygons:
    polygon.use_smooth = True
body.data.update()
body.data.calc_loop_triangles()
world = body.matrix_world.copy()
positions = []
for vertex in body.data.vertices:
    p = world @ vertex.co
    positions.extend([p.x, p.z, -p.y])
indices = [i for triangle in body.data.loop_triangles for i in triangle.vertices]
geometry_file.parent.mkdir(parents=True, exist_ok=True)
payload = json.dumps({'generator': 'tools/refine-drawing-mannequin.py', 'voxelMetres': .0035, 'positions': positions, 'indices': indices}, separators=(',', ':')).encode('utf-8')
geometry_file.write_bytes(gzip.compress(payload, mtime=0))

# Preserve a fully bound editable Blender source, not just an unbound sculpture.
controls = [('Hips', 1.005), ('Spine', 1.095), ('Spine1', 1.18), ('Chest', 1.28), ('UpperChest', 1.395), ('Neck', 1.52)]
groups = {name: body.vertex_groups.new(name=name) for name, _ in controls}
for vertex in body.data.vertices:
    y = (world @ vertex.co).z
    weights = [(controls[-1][0], 1)]
    if y <= controls[0][1]:
        weights = [(controls[0][0], 1)]
    else:
        for i in range(1, len(controls)):
            if y <= controls[i][1]:
                t = (y - controls[i - 1][1]) / (controls[i][1] - controls[i - 1][1])
                t = t * t * (3 - 2 * t)
                weights = [(controls[i - 1][0], 1 - t), (controls[i][0], t)]
                break
    for name, weight in weights:
        if weight > 0:
            groups[name].add([vertex.index], weight, 'REPLACE')
body.parent = armature
body.matrix_world = world
modifier = body.modifiers.new('Figure skin', 'ARMATURE')
modifier.object = armature
armature.show_in_front = True
blend_file.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(blend_file))
print('REFINED_MANNEQUIN', len(body.data.vertices), len(indices) // 3, geometry_file, blend_file)
