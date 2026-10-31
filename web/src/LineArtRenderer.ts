import * as THREE from 'three';

// Screen-space contours use the rendered geometry, including skinned and animal meshes.
// No character materials, bones or pose data are changed by this pass.
export class LineArtRenderer {
  private normal = new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  private depth = new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  private normals = new THREE.MeshNormalMaterial({toneMapped:false,side:THREE.DoubleSide});
  private depths = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,toneMapped:false,side:THREE.DoubleSide});
  private screen = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  private material = new THREE.ShaderMaterial({
    toneMapped:false,depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth,
    uniforms:{normals:{value:null},depths:{value:null},stepSize:{value:new THREE.Vector2()},pixelSize:{value:new THREE.Vector2()},cameraNear:{value:.01},cameraFar:{value:100},perspective:{value:1},transparentOutput:{value:0},guidesOnly:{value:0}},
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:`#include <packing>
      uniform sampler2D normals;
      uniform sampler2D depths;
      uniform vec2 stepSize,pixelSize;
      uniform float cameraNear,cameraFar,perspective,transparentOutput,guidesOnly;
      varying vec2 vUv;
      float depthAt(vec2 uv){float d=unpackRGBAToDepth(texture2D(depths,uv));
        return -mix(orthographicDepthToViewZ(d,cameraNear,cameraFar),perspectiveDepthToViewZ(d,cameraNear,cameraFar),perspective);}
      vec4 shade(vec2 uv){
        vec4 center=texture2D(normals,uv);float edge=0.0;
        vec3 n=normalize(center.xyz*2.0-1.0);float z=depthAt(uv);
        for(int i=0;i<4;i++){
          float a=float(i)*0.78539816339;vec2 offset=vec2(cos(a),sin(a))*stepSize;
          vec4 left=texture2D(normals,uv-offset),right=texture2D(normals,uv+offset);
          edge=max(edge,max(abs(left.a-center.a),abs(right.a-center.a)));
          if(center.a>.5&&left.a>.5&&right.a>.5){
            float bend=max(1.0-dot(n,normalize(left.xyz*2.0-1.0)),1.0-dot(n,normalize(right.xyz*2.0-1.0)));
            edge=max(edge,smoothstep(.22,.42,bend));
            float discontinuity=abs(depthAt(uv-offset)+depthAt(uv+offset)-2.0*z);
            edge=max(edge,smoothstep(.008,.025,discontinuity));
          }
        }
        float alpha=mix(1.0,max(center.a,edge),transparentOutput);
        return vec4(vec3(mix(1.0,.006,edge))*alpha,alpha);
      }
      void main(){
        vec2 q=pixelSize*.25;
        vec4 color=.25*(shade(vUv+q)+shade(vUv-q)+shade(vUv+vec2(q.x,-q.y))+shade(vUv+vec2(-q.x,q.y)));
        gl_FragColor=vec4(color.rgb/max(color.a,.0001),color.a);
        if(guidesOnly>.5)gl_FragColor=transparentOutput>.5?vec4(0.0):vec4(1.0);
        gl_FragDepth=unpackRGBAToDepth(texture2D(depths,vUv));
        #include <colorspace_fragment>
      }`,
  });
  constructor(){this.screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material));}

  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,target:THREE.WebGLRenderTarget|null,width:number,height:number,transparent=false,lineWidth=1.25,guidesOnly=false){
    // Supersampling softens subpixel contours without changing exported pixel dimensions.
    const scale=Math.min(2,2048/Math.max(width,height)),w=Math.round(width*scale),h=Math.round(height*scale);
    this.normal.setSize(w,h);this.depth.setSize(w,h);
    const state={target:renderer.getRenderTarget(),color:renderer.getClearColor(new THREE.Color()),alpha:renderer.getClearAlpha(),tone:renderer.toneMapping,autoClear:renderer.autoClear,background:scene.background,override:scene.overrideMaterial,shadow:renderer.shadowMap.autoUpdate};
    try{
      renderer.autoClear=true;renderer.toneMapping=THREE.NoToneMapping;renderer.shadowMap.autoUpdate=false;scene.background=null;
      scene.overrideMaterial=this.normals;renderer.setClearColor(0,0);renderer.setRenderTarget(this.normal);renderer.render(scene,camera);
      scene.overrideMaterial=this.depths;renderer.setClearColor(0xffffff,1);renderer.setRenderTarget(this.depth);renderer.render(scene,camera);
      const u=this.material.uniforms;u.normals.value=this.normal.texture;u.depths.value=this.depth.texture;u.stepSize.value.set(lineWidth/width,lineWidth/height);u.pixelSize.value.set(1/width,1/height);u.cameraNear.value=camera.near;u.cameraFar.value=camera.far;u.perspective.value=camera instanceof THREE.PerspectiveCamera?1:0;u.transparentOutput.value=transparent?1:0;u.guidesOnly.value=guidesOnly?1:0;
      renderer.setClearColor(0xffffff,transparent?0:1);renderer.setRenderTarget(target);renderer.render(this.screen,this.camera);
    }finally{
      scene.background=state.background;scene.overrideMaterial=state.override;renderer.setRenderTarget(state.target);renderer.setClearColor(state.color,state.alpha);renderer.toneMapping=state.tone;renderer.autoClear=state.autoClear;renderer.shadowMap.autoUpdate=state.shadow;
    }
  }
  dispose(){this.normal.dispose();this.depth.dispose();this.normals.dispose();this.depths.dispose();this.material.dispose();this.screen.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});this.screen.clear();}
}
