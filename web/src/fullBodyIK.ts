import {Bone,Quaternion,Vector3} from 'three';

export type PositionGoal={name:string;target:Vector3;weight:number;floor?:boolean};
export type SolverJoint={bone:Bone;axes:Vector3[];mobility:number;translation?:boolean};
type State={position:Vector3;quaternion:Quaternion}[];
export const LOCAL_AXES=[new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)];
export const captureJoints=(joints:SolverJoint[]):State=>joints.map(j=>({position:j.bone.position.clone(),quaternion:j.bone.quaternion.clone()}));
export function restoreJoints(joints:SolverJoint[],state:State){joints.forEach((j,i)=>{j.bone.position.copy(state[i].position);j.bone.quaternion.copy(state[i].quaternion);});joints[0]?.bone.updateWorldMatrix(true,true);}
export function interpolateJoints(joints:SolverJoint[],from:State,to:State,t:number){joints.forEach((j,i)=>{j.bone.position.lerpVectors(from[i].position,to[i].position,t);j.bone.quaternion.slerpQuaternions(from[i].quaternion,to[i].quaternion,t);});joints[0]?.bone.updateWorldMatrix(true,true);}
export const goalError=(goal:PositionGoal,p:Vector3)=>goal.floor?Math.max(0,goal.target.y-p.y):p.distanceTo(goal.target);

function choleskySolve(matrix:Float64Array,rhs:Float64Array,n:number){
  const l=new Float64Array(n*n),y=new Float64Array(n),x=new Float64Array(n);
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let value=matrix[i*n+j];for(let k=0;k<j;k++)value-=l[i*n+k]*l[j*n+k];
    l[i*n+j]=i===j?Math.sqrt(Math.max(value,1e-12)):value/l[j*n+j];
  }
  for(let i=0;i<n;i++){let value=rhs[i];for(let k=0;k<i;k++)value-=l[i*n+k]*y[k];y[i]=value/l[i*n+i];}
  for(let i=n-1;i>=0;i--){let value=y[i];for(let k=i+1;k<n;k++)value-=l[k*n+i]*x[k];x[i]=value/l[i*n+i];}return x;
}

/** Damped least squares with anatomical projection on every trial step and a
 * backtracking line search. No bone translations except the explicit pelvis DOF.
 * Hard-contact feasibility is checked separately by the controller. */
export function solveConstrainedIK(bones:Record<string,Bone>,joints:SolverJoint[],goals:PositionGoal[],project:(name:string)=>void,iterations=20){
  if(!joints.length||!goals.length)return {iterations:0,error:0};
  const parents=goals.map(goal=>{const set=new Set<Bone>();let bone=bones[goal.name]?.parent;while(bone instanceof Bone){set.add(bone);bone=bone.parent;}return set;});
  const columns=joints.flatMap((joint,index)=>joint.axes.map(axis=>({joint,index,axis})));
  const m=goals.length*3,n=columns.length;
  const positions=()=>goals.map(g=>bones[g.name].getWorldPosition(new Vector3()));
  const cost=(points:Vector3[])=>points.reduce((sum,p,i)=>sum+goalError(goals[i],p)**2*goals[i].weight**2,0);
  let used=0;
  for(;used<iterations;used++){
    const points=positions(),beforeCost=cost(points);if(beforeCost<1e-10)break;
    const jacobian=new Float64Array(m*n),error=new Float64Array(m);
    goals.forEach((goal,i)=>{const delta=goal.floor?new Vector3(0,Math.max(0,goal.target.y-points[i].y),0):goal.target.clone().sub(points[i]);delta.multiplyScalar(goal.weight);error.set(delta.toArray(),i*3);});
    columns.forEach(({joint,axis},c)=>{
      const bone=joint.bone,parent=bone.parent!.getWorldQuaternion(new Quaternion()),origin=bone.getWorldPosition(new Vector3()),q=bone.quaternion.clone(),p=bone.position.clone(),epsilon=.0001;
      const sample=(sign:number)=>{
        bone.quaternion.copy(q);bone.position.copy(p);
        if(joint.translation)bone.position.addScaledVector(axis,sign*epsilon);
        else bone.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis,sign*epsilon));
        project(bone.name);return {q:bone.quaternion.clone(),p:bone.position.clone()};
      };
      const plus=sample(1),minus=sample(-1);bone.quaternion.copy(q);bone.position.copy(p);bone.updateWorldMatrix(false,true);
      let effective:Vector3;
      if(joint.translation)effective=plus.p.sub(minus.p).divideScalar(2*epsilon);
      else{
        const delta=plus.q.multiply(minus.q.invert()).normalize();if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
        const vector=new Vector3(delta.x,delta.y,delta.z),length=vector.length();effective=vector.multiplyScalar(length>1e-12?2*Math.atan2(length,delta.w)/(length*2*epsilon):0);
      }
      const worldAxis=effective.applyQuaternion(parent);
      goals.forEach((goal,i)=>{
        if(joint.translation?(joint.bone!==bones[goal.name]&&!parents[i].has(joint.bone)):!parents[i].has(joint.bone))return;
        const derivative=joint.translation?worldAxis.clone():new Vector3().crossVectors(worldAxis,points[i].clone().sub(origin));
        if(goal.floor){derivative.x=derivative.z=0;if(points[i].y>=goal.target.y)derivative.y=0;}
        derivative.multiplyScalar(joint.mobility*goal.weight);for(let k=0;k<3;k++)jacobian[(i*3+k)*n+c]=derivative.getComponent(k);
      });
    });
    const matrix=new Float64Array(m*m);
    for(let i=0;i<m;i++)for(let j=0;j<=i;j++){
      let value=0;for(let c=0;c<n;c++)value+=jacobian[i*n+c]*jacobian[j*n+c];
      matrix[i*m+j]=matrix[j*m+i]=value+(i===j?.035**2:0);
    }
    const solved=choleskySolve(matrix,error,m),deltas=joints.map(()=>new Vector3());
    columns.forEach(({joint,index,axis},c)=>{let value=0;for(let row=0;row<m;row++)value+=jacobian[row*n+c]*solved[row];deltas[index].addScaledVector(axis,value*joint.mobility);});
    // Scale the whole step together. Clamping each joint independently destroys
    // the compensating leg motion that keeps the high-priority contacts still.
    const stepScale=Math.min(1,...deltas.map((delta,i)=>(joints[i].translation ? .03 : .14)/Math.max(delta.length(),1e-12)));
    deltas.forEach(delta=>delta.multiplyScalar(stepScale));
    const state=captureJoints(joints);let accepted=false;
    for(const step of [1,.5,.25,.125]){
      restoreJoints(joints,state);
      joints.forEach((joint,i)=>{
        const delta=deltas[i].clone().multiplyScalar(step);
        if(joint.translation)joint.bone.position.add(delta);
        else if(delta.lengthSq()>1e-16)joint.bone.quaternion.premultiply(new Quaternion().setFromAxisAngle(delta.clone().normalize(),delta.length()));
        project(joint.bone.name);
      });
      joints[0].bone.updateWorldMatrix(true,true);
      if(cost(positions())<beforeCost-1e-12){accepted=true;break;}
    }
    if(!accepted){restoreJoints(joints,state);break;}
  }
  const error=Math.max(...positions().map((p,i)=>goalError(goals[i],p)));
  return {iterations:used,error};
}
