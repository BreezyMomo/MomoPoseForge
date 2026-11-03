# 06 · Workspace and saving

[简体中文](06-workspace-and-storage.md) · [English](06-workspace-and-storage.en.md)

[Manual](README.en.md) · [FAQ](faq.en.md)

## Arrange panels

Drag a panel tab and release over a docking target to split, merge into tabs or create an in-page floating panel. Resize with dividers. Restore closed panels, select presets or save named layouts using **Layout**.

Layout changes do not rebuild actors or clear their poses. Narrow screens primarily use tabs: open the library or properties you need, then return to the viewport. Preset columns adapt to panel width.

## Appearance and language

The top **Appearance** control exposes the theme, control style, tabs and density supported by this workspace. Preview changes, save to retain them or cancel to restore the prior selection. UI appearance does not change character colors, projects or exported images.

The language selector supports Simplified Chinese and English. Fixed UI text and the manual link follow the selection; your actor, project and favorite names are not translated. Some solver/file-validation messages may still be in Chinese.

Layout, appearance and language are site preferences, outside project data and pose undo.

## Choose a save format

| Method | Contents | Use |
| --- | --- | --- |
| Automatic draft | Current scene; resources remain in the local library | Resume at the same browser/address |
| Complete `.poseforge` | All actors, shared scene, custom appearance bytes and selected external clips | Transfer, sharing and backup |
| Lightweight `.scene.json` | Scene and resource references | Target browser already has the same resources |
| Pose favorites | Compatible pose and thumbnail | Apply to the selected actor without replacing the scene |
| Hand favorites | Hand shape | Reuse fingers or transfer a hand library |
| Image ZIP | References, control data, manifest and scene JSON | Drawing, compositing or external AI workflows |

Complete bundles are limited to 128 MiB and 24 distinct external clips. Shared source resources are deduplicated. Built-in models come from the receiving app, which must support the corresponding rig version. Legacy `.pose.json` and v1 bundles open as single-actor scenes.

An image ZIP or lightweight JSON is not a full resource backup. Transfer a `.poseforge` and verify it on the receiving device.

## Continue on another device

1. Choose the complete project format in **Save project** and select external clips. Each actor's current clip is selected by default.
2. Transfer the downloaded file.
3. On the other device, choose **Open project**.
4. Check actors, appearances, static poses and clip bookmarks before editing.

Project loading validates resources before replacing the scene; failure retains the current scene. Loading stays in static edit mode instead of playing every actor. Session undo stacks and cached poses for alternate rigs are not transferred.

## Local storage and recovery

Storage is scoped by address. `localhost`, `127.0.0.1`, different ports, hosted URLs and different browsers do not share it automatically. Private browsing, permissions and browser cleanup affect persistence.

Clearing site data may remove drafts, favorites, assets and preferences. There is no server copy. Save a complete project before addressing a storage-quota problem.

When a local draft's optional appearance is unavailable, recovery can use the original surface while preserving the pose. Other draft-recovery errors retain the original draft rather than overwrite it with an empty scene. Explicit project imports still validate required resources strictly.
