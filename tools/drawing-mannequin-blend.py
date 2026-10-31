"""Create an editable Blender copy of the original generated mannequin.
Run Blender --background --factory-startup --disable-autoexec --python this.py
-- input.glb output.blend. Does not touch an existing Blender session.
"""
import bpy
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[sys.argv.index('--') + 1:])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)  # Only the background factory-startup scene.
bpy.ops.import_scene.gltf(filepath=str(source))
for obj in bpy.context.scene.objects:
    if obj.type == 'ARMATURE':
        obj.show_in_front = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
destination.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(destination))
print('SAVED_DRAWING_MANNEQUIN', destination)
