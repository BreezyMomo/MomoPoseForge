# Motion import fixture

`mixamo-motion.fbx` is an ASCII FBX 7.4 test fixture authored for MomoPoseForge. It contains a 20-joint human hierarchy with conventional Mixamo names, no meshes or textures, and a one-second left-arm raise plus horizontal root travel. Coordinates are centimetres; tests verify conversion to the editor’s fixed human proportions.

This fixture is not a downloaded Mixamo animation. Optional compatibility checks use separately acquired, ignored files in `web/assets-source`; their pinned sources and hashes are recorded in `docs/implementation-v0.1.md`.

`skinned-character.fbx` is a self-authored three-vertex cloth triangle weighted to the hip of the editor's 68-bone hierarchy. It contains no downloaded surface, motion or texture. Regenerate with `node tools/prepare-character-fixture.mjs`. It verifies centimetre conversion, skin binding and canonical bone reuse offline. Texture policy tests add small authored Video/Texture nodes to the motion fixture; image loading is stubbed in Node.
