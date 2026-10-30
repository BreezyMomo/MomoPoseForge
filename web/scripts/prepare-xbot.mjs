// Existing X Bot entry point; keep its source and normalization contract.
import {prepareMixamo} from './prepare-mixamo.mjs';
await prepareMixamo({character:'X Bot',slug:'xbot',rigId:'mixamo-xbot-v2',height:1.7,
  sourceUrl:'https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/Xbot.glb',
  sourceSha256:'002f8d269de68e5dce3d25195caf390d1aa359bbfaae3fcf4c8dc78ec36c3ba5',
  distribution:'Three.js r180 official example'});
