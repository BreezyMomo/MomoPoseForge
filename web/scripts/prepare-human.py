"""Build the shipped, genuinely skinned human from MakeHuman's CC0 core assets.

Run with Python 3.11+: python scripts/prepare-human.py
No Blender, model inference, or third-party Python packages are required.
The upstream revision is pinned so rebuilding does not silently change the rig.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct
import urllib.request


REVISION = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482"
BASE_URL = f"https://raw.githubusercontent.com/makehumancommunity/makehuman/{REVISION}/"
OUT = Path(__file__).resolve().parents[1] / "public" / "models"
SOURCE_PATHS = {
    "mesh": "makehuman/data/3dobjs/base.obj",
    "skeleton": "makehuman/data/rigs/default.mhskel",
    "weights": "makehuman/data/rigs/default_weights.mhw",
    "license": "LICENSE.md",
}


def add(a, b):
    return [a[i] + b[i] for i in range(3)]


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(v):
    length = math.sqrt(sum(x * x for x in v))
    return [x / length for x in v] if length > 1e-12 else [0, 1, 0]


def flatten(rows):
    return [value for row in rows for value in row]


def main():
    source = {}
    hashes = {}
    for key, path in SOURCE_PATHS.items():
        request = urllib.request.Request(BASE_URL + path, headers={"User-Agent": "MomoPoseForge asset builder"})
        source[key] = urllib.request.urlopen(request, timeout=60).read()
        hashes[key] = hashlib.sha256(source[key]).hexdigest()

    rig = json.loads(source["skeleton"])
    weights = json.loads(source["weights"])
    if rig.get("license") != "CC0" or weights.get("license") != "CC0":
        raise ValueError("Upstream skeleton and weights must explicitly declare CC0")

    vertices = []
    body_faces = []
    group = ""
    for line in source["mesh"].decode("utf-8").splitlines():
        if line.startswith("v "):
            vertices.append([float(value) for value in line.split()[1:4]])
        elif line.startswith("g "):
            group = line[2:].strip()
        elif line.startswith("f ") and group == "body":
            face = [int(part.split("/")[0]) - 1 for part in line.split()[1:]]
            for index in range(1, len(face) - 1):
                body_faces.append([face[0], face[index], face[index + 1]])

    used = sorted({index for face in body_faces for index in face})
    min_y = min(vertices[index][1] for index in used)
    max_y = max(vertices[index][1] for index in used)
    scale = 1.7 / (max_y - min_y)

    def transform(point):
        return [point[0] * scale, (point[1] - min_y) * scale, point[2] * scale]

    def joint(name, part="head"):
        indices = rig["joints"][rig["bones"][name][part]]
        return transform([sum(vertices[index][axis] for index in indices) / len(indices) for axis in range(3)])

    # The application uses one upper/lower limb pair. The source has extra twist
    # segments; their weights are summed into the equivalent application bone.
    definitions = [
        ("Hips", None, "spine05"),
        ("Spine", "Hips", "spine04"),
        ("Spine1", "Spine", "spine03"),
        ("Chest", "Spine1", "spine02"),
        ("UpperChest", "Chest", "spine01"),
        ("Neck", "UpperChest", "neck01"),
        ("Head", "Neck", "head"),
    ]
    for side, suffix in [("Left", ".L"), ("Right", ".R")]:
        definitions.extend([
            (side + "Shoulder", "UpperChest", "clavicle" + suffix),
            (side + "Arm", side + "Shoulder", "upperarm01" + suffix),
            (side + "ForeArm", side + "Arm", "lowerarm01" + suffix),
            (side + "Hand", side + "ForeArm", "wrist" + suffix),
            (side + "UpLeg", "Hips", "upperleg01" + suffix),
            (side + "Leg", side + "UpLeg", "lowerleg01" + suffix),
            (side + "Foot", side + "Leg", "foot" + suffix),
            (side + "ToeBase", side + "Foot", "toe2-1" + suffix),
        ])
        for number, finger in enumerate(["Thumb", "Index", "Middle", "Ring", "Little"], 1):
            for segment in range(1, 4):
                definitions.append((
                    f"{side}{finger}{segment}",
                    side + "Hand" if segment == 1 else f"{side}{finger}{segment - 1}",
                    f"finger{number}-{segment}{suffix}",
                ))

    bone_names = [entry[0] for entry in definitions]
    bone_index = {name: index for index, name in enumerate(bone_names)}
    rest = {name: joint(source_name) for name, _, source_name in definitions}
    parents = {name: parent for name, parent, _ in definitions}
    source_to_bone = {source_name: name for name, _, source_name in definitions}
    source_to_bone["root"] = "Hips"
    source_to_bone["spine05"] = "Hips"
    source_to_bone["neck02"] = "Neck"
    source_to_bone["neck03"] = "Neck"
    for side, suffix in [("Left", ".L"), ("Right", ".R")]:
        for prefix, target in [
            ("shoulder01", "Shoulder"),
            ("upperarm02", "Arm"),
            ("lowerarm02", "ForeArm"),
            ("pelvis", "Hips"),
            ("upperleg02", "UpLeg"),
            ("lowerleg02", "Leg"),
        ]:
            source_to_bone[prefix + suffix] = "Hips" if target == "Hips" else side + target
        for number in range(1, 5):
            source_to_bone[f"metacarpal{number}{suffix}"] = side + "Hand"
        for source_name in rig["bones"]:
            if source_name.startswith("toe") and source_name.endswith(suffix):
                source_to_bone[source_name] = side + "ToeBase"
        source_to_bone["breast" + suffix] = "Chest"

    def mapped_bone(source_name):
        # Facial helpers and other small deformation bones collapse into their
        # closest retained ancestor. This preserves all original body weights.
        original = source_name
        while source_name and source_name not in source_to_bone:
            source_name = rig["bones"][source_name].get("parent")
        return source_to_bone[source_name] if source_name else "Head" if original != "root" else "Hips"

    per_vertex = [dict() for _ in vertices]
    for source_name, assignments in weights["weights"].items():
        target = bone_index[mapped_bone(source_name)]
        for index, weight in assignments:
            if weight > 0:
                per_vertex[index][target] = per_vertex[index].get(target, 0) + weight

    compact = {source_index: index for index, source_index in enumerate(used)}
    positions = [transform(vertices[index]) for index in used]
    triangles = [[compact[index] for index in face] for face in body_faces]
    skin_indices = []
    skin_weights = []
    for source_index in used:
        influences = sorted(per_vertex[source_index].items(), key=lambda item: item[1], reverse=True)[:4]
        if not influences:
            influences = [(bone_index["Hips"], 1)]
        total = sum(weight for _, weight in influences)
        skin_indices.append([index for index, _ in influences] + [0] * (4 - len(influences)))
        skin_weights.append([weight / total for _, weight in influences] + [0] * (4 - len(influences)))

    # MakeHuman's body deliberately omits eyeball meshes. Fill both sockets with
    # the same neutral material so the asset reads as an art mannequin.
    for suffix in [".L", ".R"]:
        center = joint("eye" + suffix)
        radius = 0.0105
        base = len(positions)
        segments, rings = 16, 10
        for ring in range(rings + 1):
            phi = math.pi * ring / rings
            for segment in range(segments + 1):
                theta = math.tau * segment / segments
                positions.append([
                    center[0] + radius * math.sin(phi) * math.cos(theta),
                    center[1] + radius * math.cos(phi),
                    center[2] + radius * math.sin(phi) * math.sin(theta),
                ])
                skin_indices.append([bone_index["Head"], 0, 0, 0])
                skin_weights.append([1, 0, 0, 0])
        for ring in range(rings):
            for segment in range(segments):
                a = base + ring * (segments + 1) + segment
                b = a + segments + 1
                triangles.extend([[a, a + 1, b], [b, a + 1, b + 1]])

    normals = [[0, 0, 0] for _ in positions]
    for a, b, c in triangles:
        normal = cross(sub(positions[b], positions[a]), sub(positions[c], positions[a]))
        for index in [a, b, c]:
            normals[index] = add(normals[index], normal)
    normals = [unit(normal) for normal in normals]

    binary = bytearray()
    buffer_views = []
    accessors = []

    def accessor(values, component_type, kind, count, target=None, bounds=None):
        while len(binary) % 4:
            binary.append(0)
        offset = len(binary)
        format_code = {5126: "f", 5123: "H", 5125: "I"}[component_type]
        binary.extend(struct.pack("<" + format_code * len(values), *values))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(binary) - offset}
        if target:
            view["target"] = target
        buffer_views.append(view)
        entry = {"bufferView": len(buffer_views) - 1, "componentType": component_type, "count": count, "type": kind}
        if bounds:
            entry["min"], entry["max"] = bounds
        accessors.append(entry)
        return len(accessors) - 1

    vertex_count = len(positions)
    position_accessor = accessor(flatten(positions), 5126, "VEC3", vertex_count, 34962, (
        [min(point[axis] for point in positions) for axis in range(3)],
        [max(point[axis] for point in positions) for axis in range(3)],
    ))
    normal_accessor = accessor(flatten(normals), 5126, "VEC3", vertex_count, 34962)
    joint_accessor = accessor(flatten(skin_indices), 5123, "VEC4", vertex_count, 34962)
    weight_accessor = accessor(flatten(skin_weights), 5126, "VEC4", vertex_count, 34962)
    indices_accessor = accessor(flatten(triangles), 5123, "SCALAR", len(triangles) * 3, 34963)

    inverse_binds = []
    for name in bone_names:
        x, y, z = rest[name]
        inverse_binds.extend([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1])
    inverse_accessor = accessor(inverse_binds, 5126, "MAT4", len(bone_names))

    nodes = [
        {"name": "MomoHuman", "children": [1, 2]},
        {"name": "HumanBody", "mesh": 0, "skin": 0},
    ]
    for name, parent, _ in definitions:
        entry = {"name": name, "translation": sub(rest[name], rest[parent]) if parent else rest[name]}
        children = [2 + bone_index[other] for other in bone_names if parents[other] == name]
        if children:
            entry["children"] = children
        nodes.append(entry)

    gltf = {
        "asset": {"version": "2.0", "generator": "MomoPoseForge MakeHuman CC0 asset builder", "copyright": "Derived from MakeHuman CC0 core assets"},
        "scene": 0,
        "scenes": [{"name": "Momo Human", "nodes": [0]}],
        "nodes": nodes,
        "meshes": [{"name": "NeutralHuman", "primitives": [{"attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor, "JOINTS_0": joint_accessor, "WEIGHTS_0": weight_accessor}, "indices": indices_accessor, "material": 0}]}],
        "materials": [{"name": "NeutralClay", "pbrMetallicRoughness": {"baseColorFactor": [0.67, 0.69, 0.72, 1], "metallicFactor": 0, "roughnessFactor": 0.78}}],
        "skins": [{"name": "Humanoid", "inverseBindMatrices": inverse_accessor, "skeleton": 2, "joints": [2 + index for index in range(len(bone_names))]}],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "extras": {"license": "CC0-1.0", "sourceRevision": REVISION, "heightMeters": 1.7, "forward": "+Z", "up": "+Y"},
    }
    encoded = json.dumps(gltf, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\0" * (-len(binary) % 4)
    output = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(encoded) + 8 + len(binary))
    output += struct.pack("<I4s", len(encoded), b"JSON") + encoded
    output += struct.pack("<I4s", len(binary), b"BIN\0") + binary

    profile = {
        "id": "momo-human-v1", "version": 1, "license": "CC0-1.0", "height": 1.7,
        "forward": "+Z", "up": "+Y", "restRotation": "identity",
        "bones": {name: {"parent": parents[name], "position": rest[name]} for name in bone_names},
        "aliases": {"hips": "Hips", "spine": "Spine", "chest": "UpperChest", "neck": "Neck", "head": "Head", **{side.lower() + part: side + part for side in ["Left", "Right"] for part in ["Shoulder", "Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase"]}},
        "chains": {
            "leftArm": ["LeftArm", "LeftForeArm", "LeftHand"],
            "rightArm": ["RightArm", "RightForeArm", "RightHand"],
            "leftLeg": ["LeftUpLeg", "LeftLeg", "LeftFoot"],
            "rightLeg": ["RightUpLeg", "RightLeg", "RightFoot"],
            "spine": ["Hips", "Spine", "Spine1", "Chest", "UpperChest", "Neck"],
        },
        "headAnchors": {
            "nose": [0, -0.00673007994, 0.15510717793],
            "leftEye": sub(joint("eye.L"), rest["Head"]),
            "rightEye": sub(joint("eye.R"), rest["Head"]),
            "leftEar": [0.070, 0.055, 0],
            "rightEar": [-0.070, 0.055, 0],
        },
        "source": {"repository": "https://github.com/makehumancommunity/makehuman", "revision": REVISION, "files": {key: {"url": BASE_URL + path, "sha256": hashes[key]} for key, path in SOURCE_PATHS.items()}},
        "mesh": {"vertices": vertex_count, "triangles": len(triangles), "bones": len(bone_names), "maxInfluences": 4},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "human.glb").write_bytes(output)
    (OUT / "human-profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    (OUT / "MAKEHUMAN-LICENSE.md").write_bytes(source["license"])
    print(json.dumps({"model": str(OUT / "human.glb"), "bytes": len(output), **profile["mesh"], "boundsMin": gltf["accessors"][0]["min"], "boundsMax": gltf["accessors"][0]["max"]}))


if __name__ == "__main__":
    main()
