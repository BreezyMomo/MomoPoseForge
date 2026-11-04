# Frequently asked questions

[简体中文](faq.md) · [English](faq.en.md)

[Manual](README.en.md) · [Development](development.en.md)

## A hand or foot will not move

Check actor visibility/lock, active animation preview, whole-character placement mode and endpoint pins. Capture/cancel animation, return to **Pose joints**, unpin the endpoint and select the correct control. FK parts generally rotate rather than translate freely.

## Is IK better than FK?

IK positions endpoints; FK controls individual joints. They work together. Direct head, tail and finger rotation remains useful. Actual capabilities depend on the rig.

## An elbow or knee bends in the wrong direction

Keep the target reachable, then adjust **Elbow / knee direction**. Bend a perfectly straight limb slightly first. Do not substitute whole-character rotation for joint editing. For a persistent issue, save a minimal reproducible project with the rig, part and steps.

## Why does Fox lack human options?

Fox has its adapted paw IK, pins and FK. It does not have human hand poses, OpenPose, full-body human reaching or X Bot sole support. BodyChan / BodyKun also do not inherit every Mixamo feature.

## What is the difference between a rig and a skin?

Changing a rig changes the selected actor's anatomy and controls. Replacing an appearance retains the rig and replaces its complete surface/clothing. Import requires compatibility; it does not auto-rig arbitrary models.

## FBX / GLB import fails

Check whether you are importing an appearance or animation. Appearances require skinning, embedded textures and a matching rig. External clips require a supported human hierarchy and animation tracks. Static meshes, external textures, incompatible rigs and unsupported VRM / BVH are not converted automatically. Failure retains the existing scene.

## My paused animation pose disappeared

Pause is still preview. Capture the current frame as a pose before switching actors/rigs. Cancel restores the pose from before preview.

## I need a true top view

Default high/low views are oblique. Change a slot to Top or Bottom in **Camera and frame**. Five slots remain. Check framing lock and refit if a character is cropped.

## OpenPose omits the fox or drawing figures

Human OpenPose currently supports X Bot / Y Bot only. Other rigs use generic joint JSON or the combined skeleton image. Hidden actors are also excluded.

## Another computer has no appearance or favorites

Browser site storage does not follow you between computers, ports or URLs. Lightweight JSON only stores references. Transfer a complete `.poseforge`; the receiving app must support its rig versions.

## Can I use my pose in Unity or another 3D application?

Yes. Choose **Export → 3D model · GLB**. Static output bakes the shape; rigged output keeps skinning and a `PoseForge_CurrentPose` clip. Unity needs a GLB importer such as glTFast. Humans, Fox and mixed scenes are supported; editor IK, pins and full motions are not converted. See [3D export](05-camera-and-export.en.md#export-to-other-3d-applications).

## Are accounts, cloud sync or AI generation included?

No. Editing/export run in the browser, and control images are for external tools. Direct ComfyUI integration remains planned.

## What does the online editor measure?

The official GitHub Pages editor uses Baidu Analytics for basic traffic and exports that finish generation and initiate a download. Project names, poses, models and image content are not actively submitted, and automatic click collection is disabled. Baidu still processes network/browser information and visitor identifiers needed for statistics. Local development and other domains do not load analytics. See [Analytics](development.en.md#official-site-analytics).

## Blank screen, missing models or slow interaction

Check WebGL2 and whether scripts/models loaded successfully. Reduce actor count, hide unnecessary actors or lower output dimensions. Subdirectory deployment needs the Pages build described in [Development](development.en.md).

## Local startup cannot resolve @momo/workbench/appearance

Stop the server, run `npm ci` from the repository root, then `npm run dev`. Retain `vendor/`, `package.json` and `package-lock.json`. Do not reuse another machine's `node_modules/` or clone other products to satisfy this dependency. Run `npm run check:setup` to inspect setup. If `npm ci` fails, retain its full install log.
