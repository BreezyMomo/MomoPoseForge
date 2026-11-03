# 05 · Cameras, five views and export

[简体中文](05-camera-and-export.md) · [English](05-camera-and-export.en.md)

[Manual](README.en.md) · [Quick start](01-quick-start.en.md)

## Observation and output views

Free observation is for editing. The five output slots use orthographic cameras. Defaults are Front, Oblique, Side, Oblique high (+45°) and Oblique low (−30°). The last two are not vertical top/bottom views.

Open **Camera and frame** to change directions/names or replace a slot with the current observation. Choose Top (+90°) or Bottom (−90°) for true vertical views. There are still five output slots.

- **Observation camera lock** prevents accidental navigation.
- **Five-view framing lock** retains the shared center and scale. Refit explicitly when posing moves content out of frame.
- **Camera bookmarks** store complete observations, up to 12, without changing poses.
- **Output frame** supports 256–2048 pixels on each side, including square, landscape, portrait and custom proportions.

Automatic framing uses the union of visible actors and props. Hidden actors are omitted; locked actors remain included.

## Surfaces, line art and construction guides

The viewport offers surface, line-art and skeleton display. Line art uses the actual mesh silhouette and edges, with 0.5–3 pixel line width, for all actors and props.

X Bot, Y Bot, BodyChan / BodyKun can display head crosses, torso centerlines, shoulder lines and pelvis guides. These follow posing and occlusion as drawing marks without changing body geometry. Fox has ordinary mesh outlines, not human construction guides.

Select the line-art export channel to produce `lineart.png`, optionally on a transparent background. The construction-guide channel creates transparent `construction-guides.png` for overlays. A viewport display mode does not automatically enable its export channel.

## Choose channels by purpose

![Export channels, framing and previews](images/en/export.jpg)

| Purpose | Suggested output | Meaning |
| --- | --- | --- |
| Drawing and composition | Surface or line art, optionally guides | Shape, occlusion, perspective and body direction |
| Human pose conditioning | OpenPose image / JSON | Supported human bodies and hand keypoints only |
| Scene spatial conditioning | Depth | Distance along the camera direction |
| Surface orientation conditioning | Normals | Surface directions, distinct from depth |
| Foreground extraction/compositing | Mask | Visible character and prop foreground |
| Custom analysis/integration | Generic joints / skeleton image | Per-actor joints, hierarchy, world and projected positions |

Set views, dimensions, background and channels, wait for the preview, then download the ZIP. Depth or normal export automatically includes `mask.png`; there is no separate mask checkbox. More channels and larger sizes take longer to render and compress.

## Identify actors in exported files

Surfaces, line art, depth, normals and masks render the visible scene together, retaining actor/prop occlusion. Hidden actors are omitted from images and joints; locked actors are included.

Human OpenPose has separate `people[]` entries with `actor_id`. Fox, BodyChan and BodyKun are not encoded as COCO humans; use generic `joints.json` or scene joints. Multi-actor `skeleton.png` can show all visible rigs while OpenPose images retain human encoding.

The manifest records dimensions, views, channels and actors; asset notes retain credits. `project.scene.json` stores the scene, while legacy `project.pose.json` represents only the selected actor. Neither carries all source resources like a complete project bundle.

## External AI workflows

The site supplies control images/data rather than generating AI images or models. The downstream model/workflow must support the selected channel, dimensions, keypoint encoding and normal convention. Files do not become conditioning inputs automatically.

AI export presets and local runner materials are available. Direct ComfyUI connection/workflow integration remains a planned feature; static export is not a live ComfyUI integration.

Next: [Workspace and saving](06-workspace-and-storage.en.md)
