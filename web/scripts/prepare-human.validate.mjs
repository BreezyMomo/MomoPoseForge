// Run from the repository root after npm install:
// node web/scripts/prepare-human.validate.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.readFileSync(path.join(webRoot, 'public', 'models', 'human.glb'));
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
const body = gltf.scene.getObjectByName('HumanBody');
assert(body?.isSkinnedMesh, 'A real SkinnedMesh must load');
assert.equal(body.skeleton.bones.length, 53);
gltf.scene.updateMatrixWorld(true);
body.skeleton.update();
const rest = body.geometry.attributes.position;
let maximumRestError = 0;
for (let index = 0; index < rest.count; index++) {
  const source = new THREE.Vector3().fromBufferAttribute(rest, index);
  const result = body.getVertexPosition(index, new THREE.Vector3());
  maximumRestError = Math.max(maximumRestError, source.distanceTo(result));
}
assert(maximumRestError < 1e-5, `Bind pose changed mesh by ${maximumRestError}`);
const bounds = new THREE.Box3().setFromObject(gltf.scene, true);
assert(Math.abs(bounds.max.y - bounds.min.y - 1.7) < 1e-5, 'Normalized body height must be 1.7 meters');

const arm = gltf.scene.getObjectByName('LeftArm');
const hand = gltf.scene.getObjectByName('LeftHand');
const rightHand = gltf.scene.getObjectByName('RightHand');
const originalHand = hand.getWorldPosition(new THREE.Vector3());
const originalRightHand = rightHand.getWorldPosition(new THREE.Vector3());
arm.rotation.z = Math.PI / 3;
gltf.scene.updateMatrixWorld(true);
body.skeleton.update();
const movedHand = hand.getWorldPosition(new THREE.Vector3());
assert(movedHand.distanceTo(originalHand) > 0.2, 'Left arm rotation must move its wrist');
assert(rightHand.getWorldPosition(new THREE.Vector3()).distanceTo(originalRightHand) < 1e-8, 'Left arm rotation must not move the right wrist');
let movedVertices = 0;
for (let index = 0; index < rest.count; index++) {
  const source = new THREE.Vector3().fromBufferAttribute(rest, index);
  const result = body.getVertexPosition(index, new THREE.Vector3());
  assert(Number.isFinite(result.x + result.y + result.z), 'Skinning must remain finite');
  if (source.distanceTo(result) > 0.01) movedVertices++;
}
assert(movedVertices > 500, 'Bone rotation must actually deform the mesh');
console.log(JSON.stringify({ loaded: true, skinnedMesh: body.name, bones: body.skeleton.bones.length, vertices: rest.count, height: bounds.max.y - bounds.min.y, maximumRestError, movedVertices, leftWristDisplacement: movedHand.distanceTo(originalHand) }, null, 2));
