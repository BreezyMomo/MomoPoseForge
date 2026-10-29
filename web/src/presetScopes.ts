export const PRESET_SCOPES = {
  all: {label:'全身',help:'替换完整姿势和手型。'},
  upper: {label:'上半身',help:'套用躯干和双臂；保留骨盆、腿部、头部角度与手型。'},
  lower: {label:'下半身',help:'套用骨盆与双腿；上身保留关节角度，随骨盆移动。'},
  head: {label:'头部',help:'只套用颈部和头部角度，头部随当前躯干朝向。'},
} as const;

export type PresetScope = keyof typeof PRESET_SCOPES;

export function inPresetScope(name:string,scope:PresetScope){
  if(scope==='all')return true;
  if(scope==='head')return name==='Neck'||name==='Head';
  if(scope==='lower')return name==='Hips'||/^(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End)$/.test(name);
  return ['Spine','Spine1','Chest','UpperChest'].includes(name)||/^(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/.test(name);
}
