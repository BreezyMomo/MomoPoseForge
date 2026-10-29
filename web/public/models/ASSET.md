# MomoPoseForge human asset

`human.glb` is a real, continuous, skinned human mesh derived from the MakeHuman project's **CC0 core assets**. It is bundled with the application; no model inference or remote asset request runs in the browser.

## Provenance

- Upstream: https://github.com/makehumancommunity/makehuman
- Pinned revision: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`
- Body mesh: `makehuman/data/3dobjs/base.obj`. Its header explicitly records the September 2020 CC0 release.
- Skeleton: `makehuman/data/rigs/default.mhskel`, explicitly labeled CC0.
- Skin weights: `makehuman/data/rigs/default_weights.mhw`, explicitly labeled CC0.
- Upstream copyright holders and the distinction between source-code and asset licenses are retained in `MAKEHUMAN-LICENSE.md`.
- Exact source URLs and SHA-256 hashes are included in `human-profile.json`.
- These assets are licensed under CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/

No community clothing, hair, skin textures, or separately licensed third-party assets are included. The MakeHuman/MPFB application code is not bundled.

## Conversion

From the `web` directory, run `python scripts/prepare-human.py` to reproduce the asset. The builder needs Python 3.11+ and network access; it uses only Python's standard library.

The builder keeps the original body topology, triangulates its quads, removes helper geometry, merges source twist/helper bone weights into a compact humanoid skeleton, normalizes and limits vertex weights to four influences, and creates smooth normals. Two simple neutral eyeballs are added to fill the source mesh's eye sockets.

The asset is 1.7 meters high, Y up, facing +Z, with soles at Y=0. It includes 13,754 vertices, 27,396 triangles and 53 bones. The bind pose uses identity bone rotations; local bone translations are the differences between world-space bind positions in `human-profile.json`.

## Application rig

Main hierarchy:

```text
Hips
  Spine
    Spine1
      Chest
        UpperChest
          Neck
            Head
          LeftShoulder
            LeftArm
              LeftForeArm
                LeftHand
          RightShoulder
            RightArm
              RightForeArm
                RightHand
  LeftUpLeg
    LeftLeg
      LeftFoot
        LeftToeBase
  RightUpLeg
    RightLeg
      RightFoot
        RightToeBase
```

Each hand also has three joints for each of Thumb, Index, Middle, Ring, and Little, named for example `LeftIndex1`, `LeftIndex2`, `LeftIndex3`.

The source rest pose is a relaxed A-like pose, with slightly bent arms and spread feet. It is not a T-pose. The application should cache the bind translations and rotations before applying presets. Parent transforms and inverse bind matrices must be preserved.

The application implements its own runtime IK and constraints. The asset contains deformation bones and skin weights; it does not contain a Blender IK control rig or a solver.

As with all linear skinning, very extreme twists can lose volume. The release checks should include overhead reach, deep squat, torso twist, and cross-legged poses.
