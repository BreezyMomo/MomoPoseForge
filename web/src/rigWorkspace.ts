import type {PoseDocument} from './types';
import type {RigDefinition} from './rigs';

export type ActorSession={document:PoseDocument;undo:PoseDocument[];redo:PoseDocument[];selected:string;activePreset:string};
export type SceneState=Pick<PoseDocument,'camera'|'views'|'referenceImage'|'props'>;
export const sceneState=(doc:PoseDocument):SceneState=>structuredClone({camera:doc.camera,views:doc.views,referenceImage:doc.referenceImage,props:doc.props});
/** Actor history must never restore a camera, reference image or scene prop from another rig. */
export function withScene(doc:PoseDocument,scene:SceneState):PoseDocument{return {...structuredClone(doc),...structuredClone(scene)};}
export const actorHistory=(doc:PoseDocument)=>{
  const entry=structuredClone(doc);delete entry.camera;delete entry.referenceImage;delete entry.props;delete entry.symmetry;return entry;
};

/** Owns pending runtimes. The caller activates only a fully prepared latest result. */
export class RigSwitchCoordinator<T extends {dispose():void}>{
  private epoch=0;
  private pending:T|null=null;
  constructor(private create:(rig:RigDefinition)=>T,private prepare:(runtime:T,rig:RigDefinition)=>Promise<void>){}
  async request(rig:RigDefinition,activate:(runtime:T)=>void,prepare?:(runtime:T)=>Promise<void>){
    const token=++this.epoch;this.pending?.dispose();this.pending=null;
    const runtime=this.create(rig);this.pending=runtime;
    try{
      await this.prepare(runtime,rig);
      if(token!==this.epoch)return false;
      await prepare?.(runtime);
      if(token!==this.epoch)return false;
      activate(runtime);this.pending=null;return true;
    }catch(error){if(token===this.epoch)throw error;return false;}
    finally{if(this.pending===runtime){this.pending=null;runtime.dispose();}}
  }
  cancel(){this.epoch++;this.pending?.dispose();this.pending=null;}
}
