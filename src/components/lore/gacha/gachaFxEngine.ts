// 機甲卡池動態（PLAN-042-B Phase J）：WebGL2 播放器。只在招募插畫的全景鑑賞裡用，由 GachaFxLive 動態載入。
//
// 畫面＝招募插畫（背景，不混色）＋粒子系統（Unity 的 UIFx_Alpha：Blend SrcAlpha [_Dst3]，預設疊加、材質可指定一般透明）
// ＋流動圖層（UI_CommonFlow 的重寫，一律疊加；UI/Flow1 照反組譯的公式，疊加或透明照材質）。
// 粒子模擬在 gachaFxSim.ts、Flow1 的 uniform 打包在 gachaFxFlow1.ts；這裡只管 GL 狀態、貼圖與每格把粒子組成四邊形。
//
// 透明混色和疊加不同，畫的先後會影響結果：系統之間照 sortingOrder、同值照 prefab 階層（＝資料順序）；流動圖層帶 under 的
// （遊戲裡階層在所有 UIParticle 之前，10-17 起 builder 會判斷）先畫，帶 beforeGroup 的畫在兩組粒子之間（10-29），其餘在所有粒子之後。
// 系統之間的順序是芬里厄（全疊加、順序無關）時期定的，混用透明的機甲上站前要對遊戲畫面確認。
// 系統與圖層帶 clip 的（遊戲裡祖先的 RectMask2D）用 scissor 裁成那個矩形，例：2052 裁決者的風只在左半邊。
//
// ── 和遊戲校準過的定值（10-16 芬里厄試作，站長判定「很像」）────────────────────────
// 流動 shader 只有編譯版，公式照參數名推回。照字面套「噪聲溶解＋擾動 −0.3」會整塊閃（每格變化量 7.9，遊戲 1.5），
// 所以這裡：不做溶解、擾動 ×0.1、沿 U（橫）推移且以 0.5 為中心、時間×1（_Time.y）、亮度 ×0.85（→ 1.6，平均色 117/55/85 對遊戲 113/53/77）。
// 試作頁的「調校」面板可以切回字面公式比較；要改這些數字，先回試作頁對遊戲畫面。
//
// 10-17（J-1）用 D3DCompiler 反組譯出編譯版的實際公式，之後補的部分照 shader 原樣：主貼圖 tiling、旋轉、時間捲動、
// _MainTex1TO／_dIsturbTexTO 以 0.5 為中心、遮罩 _Mask1；材質沒指定的貼圖綁 shader 預設（擾動 black、遮罩 white）。
// 實際公式的擾動是 (2r−1)×_DisturbValue×0.1、預設兩軸都推，alpha 也乘 _MainValue，溶解也有確切算式——都和上面的校準版不同，
// 但校準值是對遊戲畫面調的，沒重新對過畫面前不動。反組譯檔：_local-notes/2026-10/2026-10-17_卡池動態_流動圖層預設貼圖/。

import { fillQuads, flow1Uniforms, isFlow1, isImage, isSpeedLine, isUICommon, splitFlows } from './gachaFxFlow1'
import { evalMinMax, evalMinMaxGradient, makePerlin, ParticleSim, speedT, uvFrame, uvRect } from './gachaFxSim'
export { ORBITAL_DEG, ORBITAL_RAD } from './gachaFxSim'
import type { FxClip, FxCommonFlow, FxCommonFlowParams, FxFlow, FxFlow1, FxFlow1Params, FxFlow1Tex, FxGeneralParams, FxImage, FxSpeedLine, FxUICommonLayer, FxUICommonParams, FxTO, GachaFxData } from './gachaFxTypes'

const FLOW_DISTURB_K = 0.1
const FLOW_GAIN = 0.85
const ST_ID: FxTO = [1, 1, 0, 0]
const WHITE = [1, 1, 1, 1]

export interface GachaFxOptions {
  /** 招募插畫（2600×1080，與鑑賞模式那張 <img> 同一個網址：瀏覽器已經有快取） */
  background: string
  /** 特效貼圖官方檔名 → 網址 */
  texUrl: (name: string) => string
  /** 第一格畫好了（父層據此淡入，不會先看到一格黑） */
  onFirstFrame?: () => void
  /** GPU 把 context 收回去了（分頁在背景太久、驅動重置…）：父層退回靜態插畫 */
  onLost?: () => void
  /** 速度模組 orbital 的單位倍率（gachaFxSim.ts 的 ORBITAL_RAD／ORBITAL_DEG；負值＝反方向、0＝關掉）；省略＝ORBITAL_RAD */
  orbitalScale?: number
  /** 照 prefab 的 simulationSpeed（見 gachaFxSim.ts 的 SimOptions）；省略＝照（10-30 起維持舊行為） */
  honorSimSpeed?: boolean
  /**
   * 拉伸 billboard 的長度公式：true＝size ×（lengthScale＋速度 × velocityScale），速度那項也乘粒子大小；
   * false（省略）＝size × lengthScale＋速度 × velocityScale（10-16 試作、站上已上線的寫法）。Unity 文件沒寫公式。
   * EN wiki（HuyT）10-29 對 3028 天角獸的 Particle_Spark4／5（velocityScale 0.4）比對遊戲畫面：true＋不照 simulationSpeed 最像，
   * 他的版本預設 true；10-30 起站上先維持舊公式，對過芬里厄等已上線的機甲再決定要不要換。
   * 芬里厄的鏈鋸火花（Chainsaw_03／04）照數字會縮成 5%，但很淡（alpha 0.17–0.28），整格畫面只差約 1250 個像素，還沒對過遊戲
   */
  streakSpeedBySize?: boolean
  /** 拖尾貼圖的 u 反過來（尾＝0、頭＝1；只影響 Stretch／DistributePerSegment）：demo 對遊戲畫面比較用，省略＝頭＝0 */
  trailUReversed?: boolean
  /** 拉伸 billboard 的長度／寬度倍率（只給 demo 對遊戲畫面調校用，找出公式差在哪；省略＝1） */
  streakLength?: number
  streakWidth?: number
}

export interface GachaFxHandle {
  destroy: () => void
}

const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; in vec4 aCol; uniform vec4 uView; out vec2 vUV; out vec4 vCol;
void main(){ vec2 c = (aPos - uView.xy) / uView.zw * 2.0 - 1.0; gl_Position = vec4(c, 0.0, 1.0); vUV = aUV; vCol = aCol; }`

// 背景：不混色
const FS_BG = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; out vec4 o; void main(){ o = texture(uTex, vUV); }`

// 粒子（UIFx_Alpha）：rgb×頂點色×顏色強度，alpha＝貼圖 a×頂點 a（×uStrA：UI/Flow1 的強度也乘 alpha，其他材質是 1）。
// uRot＝主貼圖旋轉（UI_CommonFlow／UI/Flow1 當粒子材質時用）；uTint＝材質色調（UI/Flow1 的 _Color，四個通道都乘，其他材質是白色——
// 乘 1 逐位元不變，沒有色調的台畫面不受影響）
const FS_PARTICLE = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; uniform float uStr; uniform float uStrA; uniform float uRot; uniform vec4 uTint; out vec4 o;
void main(){ vec2 uv = vUV - 0.5; float c = cos(uRot), s = sin(uRot); uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y) + 0.5;
  vec4 t = texture(uTex, uv) * uTint; o = vec4(t.rgb * vCol.rgb * uStr, t.a * vCol.a * uStrA); }`

// 流動圖層（UI_CommonFlow）：擾動貼圖捲動、沿 U 推移主貼圖（校準版）；UV 的變換順序與遮罩照 shader；不做溶解（見檔頭）。
// 旋轉的 r＝(cos, sin)，方向照 shader（UV 乘 [[c, s], [−s, c]]）。rot／to 以 0.5 為中心，但寫成「線性部分＋只含 uniform 的常數」：
// 材質是預設值時兩者都恰好是恆等（寫成 (p−0.5)+0.5 會有浮點捨入，fract 接縫上的像素會跳），芬里厄逐像素不變。
const FS_FLOW = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uMain, uDst, uMask; uniform float uTime, uMainValue, uDstVal, uVRepeat, uRepeatU, uMaskSoft, uMaskRev, uMaskDst;
uniform vec2 uDstFlow, uMainFlow, uMainRot, uMaskRot, uDstAxis; uniform vec4 uMainTO, uDstTO, uMainST, uDstST, uMaskST, uMaskTO; out vec4 o;
vec2 rot(vec2 p, vec2 r){ return vec2(r.x * p.x + r.y * p.y, r.x * p.y - r.y * p.x) + (0.5 - vec2(r.x + r.y, r.x - r.y) * 0.5); }
vec2 to(vec2 p, vec4 t){ return p * t.xy + ((t.zw - 0.5) * t.xy + 0.5); }
void main(){
  float d = texture(uDst, to(rot(vUV * uDstST.xy + uDstST.zw, uMainRot) + uTime * uDstFlow, uDstTO)).r;
  float dx = (d - 0.5) * uDstVal;
  vec2 muv = rot(vUV * uMainST.xy + uMainST.zw, uMainRot);
  muv += uDstAxis * dx;
  muv = to(muv + uTime * uMainFlow, uMainTO);
  muv.x = uRepeatU > 0.5 ? muv.x : clamp(muv.x, 0.0, 1.0);
  muv.y = uVRepeat > 0.5 ? fract(muv.y) : clamp(muv.y, 0.0, 1.0);
  vec4 m = texture(uMain, muv);
  vec2 kuv = rot(vUV * uMaskST.xy + uMaskST.zw, uMaskRot);
  if (uMaskDst > 0.5) kuv += uDstAxis * dx;
  vec4 k = texture(uMask, to(kuv, uMaskTO));
  float s = clamp((k.r * k.a - uMaskSoft) / (1.0 - 2.0 * uMaskSoft), 0.0, 1.0);
  s = s * s * (3.0 - 2.0 * s);
  if (uMaskRev > 0.5) s = 1.0 - s;
  o = vec4(m.rgb * vCol.rgb * uMainValue, m.a * vCol.a * s);
}`

// 流動圖層（UI/Flow1）：照反組譯逐行寫（_local-notes/2026-10/2026-10-17_卡池動態_Flow1/README.md 的「片段 shader」）。
// 沒有校準值，跟上面的 FS_FLOW 不同：擾動是往 D 內插（axis 選推哪幾軸）、TO 的位移在擾動前、tiling 在擾動後，
// 遮罩與溶解乘四個通道，mainValue 也乘 alpha。旋轉方向同 FS_FLOW 的 rot()；sc() 是只有 tiling 的 TO。
// 預設值時 rot／sc／擾動都恰好恆等（旋轉 (1,0)、tiling 1、k＝0），白貼圖的遮罩、溶解恰好是 1。
// 第二張主貼圖 _MainTex2（41 個材質的 _Tex2Intensity 全是 0）與粒子 Custom Data（_ModeCtrl）沒做，builder 遇到會報 ⚠。
const FS_FLOW1 = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uMain, uColor, uDst, uDis, uDisMask, uMask1, uMask2, uMain2;
uniform float uTime, uK, uVClamp, uChR, uM1Soft, uM1Rev, uM2Soft, uM2Rev, uDisRev, uDisC, uDisSoft, uMainValue, uTex2I, uTex2Pow;
uniform vec2 uMainRot, uColRot, uM1Rot, uMainFlow, uDstFlow, uDisFlow, uAxis, uDisAxis, uTex2Flow;
uniform vec4 uMainTO, uDstTO, uColST, uM1ST, uM2ST, uDisST, uDisMaskST, uTex2TO, uTex2ST; out vec4 o;
vec2 rot(vec2 p, vec2 r){ return vec2(r.x * p.x + r.y * p.y, r.x * p.y - r.y * p.x) + (0.5 - vec2(r.x + r.y, r.x - r.y) * 0.5); }
vec2 to(vec2 p, vec4 t){ return p * t.xy + ((t.zw - 0.5) * t.xy + 0.5); }
vec2 sc(vec2 p, vec4 t){ return p * t.xy + (0.5 - 0.5 * t.xy); }
float mask(vec4 k, float soft, float rev){
  float s = clamp((k.r * k.a - soft) / (1.0 - 2.0 * soft), 0.0, 1.0);
  s = s * s * (3.0 - 2.0 * s);
  return rev > 0.5 ? 1.0 - s : s;
}
void main(){
  vec2 uvR = rot(vUV, uMainRot);
  float d = texture(uDst, to(uvR + uTime * (uMainFlow + uDstFlow), uDstTO)).r;
  vec2 q = uvR + uTime * uMainFlow + uMainTO.zw;
  q += uK * (d - q) * uAxis;
  q = sc(q, uMainTO);
  if (uVClamp > 0.5) q.y = clamp(q.y, 0.0, 1.0);
  vec4 m = texture(uMain, q);
  if (uChR > 0.5) m = m.rrrr;
  // 第二張主貼圖（10-29 補，shaders/Flow1/ 的反組譯）：強度 0 時 ＋0，畫面逐位元不變
  if (uTex2I != 0.0) {
    vec2 q2 = rot(vUV * uTex2ST.xy + uTex2ST.zw, uMainRot) + uTime * uTex2Flow + uTex2TO.zw;
    q2 += uK * (d - q2) * uAxis;
    m += uTex2I * pow(texture(uMain2, sc(q2, uTex2TO)).r, uTex2Pow) * m.a;
  }
  m.a = clamp(m.a, 0.0, 1.0);
  m *= mask(texture(uMask1, rot(vUV * uM1ST.xy + uM1ST.zw, uM1Rot)), uM1Soft, uM1Rev);
  m *= mask(texture(uMask2, vUV * uM2ST.xy + uM2ST.zw), uM2Soft, uM2Rev);
  vec2 dq = vUV * uDisST.xy + uDisST.zw + uTime * uDisFlow;
  dq += uK * (d - dq) * uDisAxis;
  vec4 dn = texture(uDis, dq), dm = texture(uDisMask, vUV * uDisMaskST.xy + uDisMaskST.zw);
  float n = dn.r * dn.a;
  if (uDisRev > 0.5) n = 1.0 - n;
  float x = clamp((dm.r * dm.a * n + uDisC - uDisSoft) / (1.0 - 2.0 * uDisSoft), 0.0, 1.0);
  m *= min(x * x * (3.0 - 2.0 * x), 1.0);
  o = m * texture(uColor, rot(vUV * uColST.xy + uColST.zw, uColRot)) * vCol * uMainValue;
}`

// UI_General（10-29 反組譯 shader_abs.b 的 D3D11 片段程式，常數槽位照 parsed form 的綁定對上屬性名，見 gachaFxTypes.ts 的 FxGeneralParams）：
// 主貼圖 UV＝uv×ST 以 0.5 為中心轉 _MainRotation（方向同 FS_FLOW 的 rot）＋時間×_MainSpeed；噪聲把 UV 往 n 內插 _NoiseValue
// （_ToggleSwitch3：改成只推原始 uv 的 u）；_MainColorRB 讓 R、B 各自偏移 0.1×值取樣；邊緣溶解是硬邊（e≥門檻）的兩個 0／1 相減；
// 軟溶解是 smoothstep；頂點 alpha 先量化成 1/255。最後乘 _MainColor、_Centre，四個通道都乘。各項在預設值時恰好是恆等
const FS_GENERAL = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uNoise, uMain, uEdge, uMask1, uSoft, uMask2;
uniform float uTime, uMainRot, uNoiseVal, uNoiseU, uEdgeOn, uEdgeVal, uEdgeRev, uEdgeW, uM1Rev, uM1Rot, uSoftRev, uSoftOn, uSoftVal, uF4, uM2Rev, uM2Rot, uCentre;
uniform vec2 uMainSpeed, uNoiseSpeed, uRB, uEdgeSpeed, uM1Speed, uSoftSpeed, uM2Speed;
uniform vec4 uMainST, uNoiseST, uEdgeST, uM1ST, uSoftST, uM2ST, uEdgeColor, uMainColor; out vec4 o;
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x + s * p.y, c * p.y - s * p.x); }
void main(){
  vec2 uv = vUV; float T = uTime;
  vec4 r0 = (rot(uv * uMainST.xy + uMainST.zw - 0.5, uMainRot) + 0.5 + T * uMainSpeed).xyxy;
  float n = texture(uNoise, uv * uNoiseST.xy + uNoiseST.zw + T * uNoiseSpeed).x;
  r0 += uNoiseVal * (n - r0);
  vec2 uvA = uNoiseU > 0.5 ? vec2((n - 0.5) * uNoiseVal + uv.x, uv.y) : r0.xy;
  r0 += uRB.xxyy * 0.1;
  vec4 s1 = texture(uMain, uvA);
  float e = texture(uEdge, uv * uEdgeST.xy + uEdgeST.zw + T * uEdgeSpeed).x;
  if (uEdgeRev > 0.5) e = 1.0 - e;
  float thr = uEdgeOn > 0.5 ? uEdgeVal : 0.0;
  float outer = e + uEdgeW >= thr ? 1.0 : 0.0, edge = outer - (e >= thr ? 1.0 : 0.0);
  vec3 col = vec3(texture(uMain, r0.xy).x, s1.y, texture(uMain, r0.zw).z);
  col += edge * (edge * uEdgeColor.rgb - col);
  col *= vCol.rgb;
  float m1 = texture(uMask1, rot(uv * uM1ST.xy + uM1ST.zw - 0.5, uM1Rot) + 0.5 + T * uM1Speed).x;
  if (uM1Rev > 0.5) m1 = 1.0 - m1;
  float sd = texture(uSoft, uv * uSoftST.xy + uSoftST.zw + T * uSoftSpeed).x;
  if (uSoftRev > 0.5) sd = 1.0 - sd;
  sd += 1.0 + (uSoftOn > 0.5 ? -2.0 * uSoftVal : 2.0) - (1.0 - uF4);
  float t = clamp(sd / (2.0 * uF4 - 1.0), 0.0, 1.0);
  float a = t * t * (3.0 - 2.0 * t) * m1 * s1.w * outer * (floor(vCol.a * 255.0 + 0.5) / 255.0);
  float m2 = texture(uMask2, rot(uv * uM2ST.xy + uM2ST.zw - 0.5, uM2Rot) + 0.5 + T * uM2Speed).x;
  if (uM2Rev > 0.5) m2 = 1.0 - m2;
  o = vec4(col, a * m2) * uMainColor * uCentre;
}`

// UI/Common（10-29 反組譯 shader_abs.b，shaders/UI_Common/；欄位見 gachaFxTypes.ts 的 FxUICommonParams）：扭曲貼圖的 r×k 加在主貼圖 UV 上、
// 乘在 alpha 貼圖 UV 上（uv×(1＋d)，shader 原樣）；主貼圖捲動是 0.5×時間；alpha＝兩張 alpha 貼圖 ×（(a×w)^power 夾到 1 ＋ dot(rgb, 通道選擇)），
// 粒子顏色的 alpha 只有開 _LIZIALPHA_ON 才乘；RGB 再乘顏色圖。power 是 1 時不呼叫 pow（0 的 pow 在某些 GPU 上不穩）
const FS_UI_COMMON = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uDist, uMain, uAlpha, uAlpha3, uGrad;
uniform float uTime, uPower, uInt, uAll, uPA, uDMain, uDAlpha;
uniform vec2 uMainSpeed, uDistSpeed, uDistK, uAlphaSpeed, uAlpha3Speed, uGradSpeed;
uniform vec3 uMainColor;
uniform vec4 uMainST, uDistST, uAlphaST, uAlpha3ST, uGradST, uAlphaSel; out vec4 o;
void main(){
  vec2 uv = vUV; float T = uTime;
  vec2 d = texture(uDist, uv * uDistST.xy + uDistST.zw + T * uDistSpeed).x * uDistK;
  float a3 = texture(uAlpha3, uv * uAlpha3ST.xy + uAlpha3ST.zw + T * uAlpha3Speed).x;
  vec2 auv = uv * uAlphaST.xy + uAlphaST.zw + T * uAlphaSpeed;
  if (uDAlpha > 0.5) auv += auv * d;
  float a = texture(uAlpha, auv).x * a3;
  vec2 muv = uv * uMainST.xy + uMainST.zw + (0.5 * T) * uMainSpeed;
  if (uDMain > 0.5) muv += d;
  vec4 m = texture(uMain, muv);
  float ma = m.a * uAlphaSel.w; vec3 mc = m.rgb;
  if (uPower != 1.0) { ma = pow(ma, uPower); mc = pow(mc, vec3(uPower)); }
  a *= min(ma, 1.0) + dot(m.rgb, uAlphaSel.rgb);
  if (uPA > 0.5) a *= vCol.a;
  vec3 col = min(mc, 1.0) * uInt * vCol.rgb * uMainColor;
  o = vec4(texture(uGrad, uv * uGradST.xy + uGradST.zw + T * uGradSpeed).rgb * col, a * uAll);
}`

// UIShiny（10-29 反組譯 globalgamemanagers.assets 的 Hidden/UI/Default (UIShiny)，shaders/UIShiny/）：c＝貼圖×頂點色；
// 位置 p 由四個角在兩個三角形上內插（對角線左下→右上，同 quad() 與 Unity 的 Image）；n＝1−min(|p−(2×factor−0.5)|／width, 1)，
// 掃光＝smoothstep(0, softness, n)×0.5×c.a×brightness；rgb ＋＝ 掃光×lerp(1, rgb×7, gloss)，alpha 不變
const FS_SHINY = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; uniform vec4 uShine, uCorner; uniform float uGloss; out vec4 o;
void main(){
  vec4 c = texture(uTex, vUV) * vCol;
  vec4 k = uCorner; vec2 q = vUV;
  float p = q.x >= q.y ? k.x + q.x * (k.y - k.x) + q.y * (k.z - k.y) : k.x + q.x * (k.z - k.w) + q.y * (k.w - k.x);
  float n = 1.0 - min(abs((p - (uShine.x * 2.0 - 0.5)) / uShine.y), 1.0);
  float s = clamp(n / uShine.z, 0.0, 1.0);
  s = s * s * (3.0 - 2.0 * s) * 0.5 * c.a * uShine.w;
  o = vec4(c.rgb + s * (1.0 + uGloss * (c.rgb * 7.0 - 1.0)), c.a);
}`

// ProjectFM/UI/SpeedLine（10-29 反組譯 shader_abs.b，shaders/SpeedLine/；欄位見 gachaFxTypes.ts 的 FxSpeedLine）：Shader Graph 產的，
// 雜訊照 Unity 的 Gradient Noise／Simple Noise 節點逐行寫（取模照 HLSL 的 %：截斷、同被除數的號，乘 1/289 再取小數，同反組譯）。
// ^density 用 log／exp：雜訊 ≤ 0 時 log 是 −inf／NaN，D3D11 的 min(NaN, 1) 回 1，所以負值整點全亮（照遊戲的 DX11 行為，沒對過畫面）
const FS_SPEEDLINE = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uMask; uniform float uTime, uRot, uU, uV, uSpeed, uDensity, uSimple, uC1, uC2, uCW, uCS, uRadial, uInner, uOuter, uBlur, uCustom;
uniform vec2 uOff; uniform vec4 uST; out vec4 o;
float m289(float x){ float k = x >= -x ? 289.0 : -289.0; return fract(x * (1.0 / k)) * k; }
vec2 gdir(vec2 p){
  p = vec2(m289(p.x), m289(p.y));
  float x = m289((34.0 * p.x + 1.0) * p.x) + p.y;
  x = m289((34.0 * x + 1.0) * x);
  x = fract(x / 41.0) * 2.0 - 1.0;
  return normalize(vec2(x - floor(x + 0.5), abs(x) - 0.5));
}
float gnoise(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float d00 = dot(gdir(ip), fp), d01 = dot(gdir(ip + vec2(0.0, 1.0)), fp - vec2(0.0, 1.0));
  float d10 = dot(gdir(ip + vec2(1.0, 0.0)), fp - vec2(1.0, 0.0)), d11 = dot(gdir(ip + vec2(1.0, 1.0)), fp - vec2(1.0, 1.0));
  fp = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
  return mix(mix(d00, d01, fp.y), mix(d10, d11, fp.y), fp.x);
}
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rnd(i), rnd(i + vec2(1.0, 0.0)), f.x), mix(rnd(i + vec2(0.0, 1.0)), rnd(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main(){
  vec2 uv = vUV * uST.xy + uST.zw, p = uv - 0.5;
  float c = cos(uRot), s = sin(uRot);
  vec2 r = vec2(c * p.x + s * p.y, c * p.y - s * p.x) + 0.5, q = r - uOff;
  float rad = 2.0 * length(q) * uU;
  vec2 P = vec2(rad - uSpeed * uTime, atan(q.x, q.y) * 0.159236 * uV);
  float n = uSimple > 0.5 ? vnoise(P * 10.0) * 0.125 + vnoise(P * 5.0) * 0.25 + vnoise(P * 2.5) * 0.5 : gnoise(P * 10.0) + 0.5;
  n = n > 0.0 ? min(exp(log(n) * uDensity), 1.0) : n < 0.0 ? 1.0 : 0.0;
  float x = uRadial > 0.5 ? rad : r.x;
  float k = mix(x * uC1, (1.0 - x) * uC2, uCW) + uCS;
  vec2 e = 1.0 - smoothstep(vec2(uOuter, uInner) - uBlur, vec2(uOuter, uInner) + uBlur, vec2(length(uv - uOff)));
  float a = uCustom > 0.5 ? texture(uMask, uv).r : e.x - e.y;
  o = vec4(k * vCol.rgb * n, a * vCol.a);
}`

/** 動態頂點緩衝：每個頂點 pos2 uv2 col4＝8 個 float */
const FLOATS = 8
const FULL_UV = [0, 0, 1, 1] as const

export async function startGachaFx(canvas: HTMLCanvasElement, data: GachaFxData, opts: GachaFxOptions): Promise<GachaFxHandle> {
  const ctx = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, antialias: true })
  if (!ctx) throw new Error('這個瀏覽器沒有 WebGL2（或關閉了硬體加速）')
  const gl: WebGL2RenderingContext = ctx

  // ── 程式 ──
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader 編譯失敗')
    return s
  }
  const program = (fs: string) => {
    const p = gl.createProgram()!
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs))
    // 每支程式的屬性都固定在同樣的位置：共用一個 VAO 時不會因編譯器排的位置不同而錯綁
    for (const [i, name] of ['aPos', 'aUV', 'aCol'].entries()) gl.bindAttribLocation(p, i, name)
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader 連結失敗')
    return p
  }
  const P_BG = program(FS_BG), P_PT = program(FS_PARTICLE), P_FLOW = program(FS_FLOW), P_FLOW1 = program(FS_FLOW1), P_GEN = program(FS_GENERAL), P_UIC = program(FS_UI_COMMON), P_SHINY = program(FS_SHINY), P_SL = program(FS_SPEEDLINE)
  const U = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]))
  const uBg = U(P_BG, ['uView', 'uTex'])
  const uPt = U(P_PT, ['uView', 'uTex', 'uStr', 'uStrA', 'uRot', 'uTint'])
  const uFl = U(P_FLOW, ['uView', 'uMain', 'uDst', 'uMask', 'uTime', 'uMainValue', 'uDstVal', 'uVRepeat', 'uRepeatU', 'uDstFlow', 'uMainFlow',
    'uMainRot', 'uMainTO', 'uDstTO', 'uMainST', 'uDstST', 'uMaskST', 'uMaskTO', 'uMaskRot', 'uMaskSoft', 'uMaskRev', 'uMaskDst', 'uDstAxis'])
  /** FS_FLOW1 的貼圖槽（照順序綁 TEXTURE0…6） */
  const FLOW1_TEX = ['uMain', 'uColor', 'uDst', 'uDis', 'uDisMask', 'uMask1', 'uMask2', 'uMain2'] as const
  const uF1 = U(P_FLOW1, ['uView', ...FLOW1_TEX, 'uTime', 'uK', 'uVClamp', 'uChR', 'uM1Soft', 'uM1Rev', 'uM2Soft', 'uM2Rev', 'uDisRev', 'uDisC', 'uDisSoft',
    'uMainValue', 'uMainRot', 'uColRot', 'uM1Rot', 'uMainFlow', 'uDstFlow', 'uDisFlow', 'uAxis', 'uDisAxis',
    'uMainTO', 'uDstTO', 'uColST', 'uM1ST', 'uM2ST', 'uDisST', 'uDisMaskST', 'uTex2I', 'uTex2Pow', 'uTex2Flow', 'uTex2TO', 'uTex2ST'])
  /** FS_GENERAL 的貼圖槽（照順序綁 TEXTURE0…5，＝ shader 的 t0…t5） */
  const GEN_TEX = ['uNoise', 'uMain', 'uEdge', 'uMask1', 'uSoft', 'uMask2'] as const
  const uGen = U(P_GEN, ['uView', ...GEN_TEX, 'uTime', 'uMainRot', 'uNoiseVal', 'uNoiseU', 'uEdgeOn', 'uEdgeVal', 'uEdgeRev', 'uEdgeW', 'uM1Rev', 'uM1Rot',
    'uSoftRev', 'uSoftOn', 'uSoftVal', 'uF4', 'uM2Rev', 'uM2Rot', 'uCentre', 'uMainSpeed', 'uNoiseSpeed', 'uRB', 'uEdgeSpeed', 'uM1Speed', 'uSoftSpeed', 'uM2Speed',
    'uMainST', 'uNoiseST', 'uEdgeST', 'uM1ST', 'uSoftST', 'uM2ST', 'uEdgeColor', 'uMainColor'])
  const uSh = U(P_SHINY, ['uView', 'uTex', 'uShine', 'uCorner', 'uGloss'])
  const uSl = U(P_SL, ['uView', 'uMask', 'uTime', 'uRot', 'uU', 'uV', 'uSpeed', 'uDensity', 'uSimple', 'uC1', 'uC2', 'uCW', 'uCS', 'uRadial', 'uInner', 'uOuter',
    'uBlur', 'uCustom', 'uOff', 'uST'])
  /** FS_UI_COMMON 的貼圖槽（照順序綁 TEXTURE0…4，＝ shader 三個關鍵字全開時的 t0…t4） */
  const UIC_TEX = ['uDist', 'uMain', 'uAlpha', 'uAlpha3', 'uGrad'] as const
  const uUic = U(P_UIC, ['uView', ...UIC_TEX, 'uTime', 'uPower', 'uInt', 'uAll', 'uPA', 'uDMain', 'uDAlpha', 'uMainSpeed', 'uDistSpeed', 'uDistK',
    'uAlphaSpeed', 'uAlpha3Speed', 'uGradSpeed', 'uMainColor', 'uMainST', 'uDistST', 'uAlphaST', 'uAlpha3ST', 'uGradST', 'uAlphaSel'])

  const vbo = gl.createBuffer(), vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  // 各程式的屬性名稱與位置都一樣（見 program）；同一個 VAO 綁一次
  for (const [loc, size, off] of [[0, 2, 0], [1, 2, 8], [2, 4, 16]] as const) {
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off)
  }
  let verts = new Float32Array(FLOATS * 6 * 1024), vn = 0
  /** 四角（逆時針：左下、右下、右上、左上）；uv＝貼圖範圍 [u0, v0, u1, v1]，預設整張（序列幀時是那一格，見 uvRect） */
  function quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: readonly number[], uv: readonly number[] = FULL_UV) {
    if (vn + FLOATS * 6 > verts.length) { const nv = new Float32Array(verts.length * 2); nv.set(verts); verts = nv }
    const [u0, v0, u1, v1] = uv
    const P = [[x0, y0, u0, v0], [x1, y1, u1, v0], [x2, y2, u1, v1], [x0, y0, u0, v0], [x2, y2, u1, v1], [x3, y3, u0, v1]]
    for (const q of P) { verts[vn++] = q[0]; verts[vn++] = q[1]; verts[vn++] = q[2]; verts[vn++] = q[3]; verts[vn++] = c[0]; verts[vn++] = c[1]; verts[vn++] = c[2]; verts[vn++] = c[3] }
  }
  /** 四個頂點各自的位置與 UV（P、T 各 8 個數，同一圈順序），三角形 0-1-2、0-2-3 */
  function quadUV(P: readonly number[], T: readonly number[], c: readonly number[]) {
    if (vn + FLOATS * 6 > verts.length) { const nv = new Float32Array(verts.length * 2); nv.set(verts); verts = nv }
    for (const k of [0, 1, 2, 0, 2, 3]) {
      verts[vn++] = P[2 * k]; verts[vn++] = P[2 * k + 1]; verts[vn++] = T[2 * k]; verts[vn++] = T[2 * k + 1]
      verts[vn++] = c[0]; verts[vn++] = c[1]; verts[vn++] = c[2]; verts[vn++] = c[3]
    }
  }
  function flush() {
    if (!vn) return
    gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, vn), gl.DYNAMIC_DRAW)
    gl.drawArrays(gl.TRIANGLES, 0, vn / FLOATS)
    vn = 0
  }

  // ── 貼圖 ──
  const textures: WebGLTexture[] = []
  async function loadTex(url: string, repeat: boolean): Promise<WebGLTexture> {
    const img = new Image()
    // 貼圖放在另一個網域（assets.mecharashi-wiki.cc）：沒設 crossOrigin 的話 WebGL 會因為跨網域污染拒絕上傳；同網域時沒有影響
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.src = url
    try { await img.decode() } catch { throw new Error(`貼圖讀不到：${url}`) }
    const t = gl.createTexture()!
    textures.push(t)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)   // Unity 的 UV 原點在左下
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w)
    return t
  }
  /** shader 的預設貼圖（Unity 的 "black"／"white"）：材質沒指定選填貼圖時綁這張 */
  function solidTex(rgba: number[]): WebGLTexture {
    const t = gl.createTexture()!
    textures.push(t)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return t
  }
  const T_BLACK = solidTex([0, 0, 0, 0]), T_WHITE = solidTex([255, 255, 255, 255])
  const cache = new Map<string, Promise<WebGLTexture>>()
  const fxTex = (name: string, repeat = false) => {
    const key = `${name}#${repeat ? 'r' : 'c'}`
    // 名字以 .webp 結尾的（10-29 起，序列幀的圖集）：texUrl 照舊給 <名字>.png，把 .png 換成 .webp（頁面不用改）
    const url = name.endsWith('.webp') ? opts.texUrl(name.slice(0, -5)).replace(/\.png(?=$|[?#])/, '.webp') : opts.texUrl(name)
    if (!cache.has(key)) cache.set(key, loadTex(url, repeat))
    return cache.get(key)!
  }

  // ── 場景 ──
  const perlin = makePerlin(Math.random)
  const [W, H] = data.canvas, UNIT = data.unit
  // 預熱在建構時跑（每個系統 duration×30 步）
  const sims = data.systems.map((s) => new ParticleSim(s, Math.random, perlin, { orbitalScale: opts.orbitalScale, honorSimSpeed: opts.honorSimSpeed }))
  // 組（UIParticle）優先：遊戲裡每個 UIParticle 是一個 UI 元素，照階層畫，sortingOrder 只排它自己底下的系統
  const order = sims.map((s, i) => [s, i] as const)
    .sort((a, b) => (a[0].sys.group ?? 0) - (b[0].sys.group ?? 0) || a[0].sys.order - b[0].sys.order || a[1] - b[1]).map((x) => x[0])
  /** UI/Flow1 的選填貼圖：省略＝shader 預設 white */
  const f1Tex = (t: FxFlow1Tex | undefined) => (t ? fxTex(t.tex, !!t.repeat) : Promise.resolve(T_WHITE))
  type CommonFlowTex = { main: WebGLTexture; dst: WebGLTexture; mask: WebGLTexture }
  type FlowEntry =
    | ({ kind: 'common'; f: FxCommonFlow } & CommonFlowTex)
    | { kind: 'flow1'; f: FxFlow1; tex: WebGLTexture[] }
    | { kind: 'image'; f: FxImage; tex: WebGLTexture; seq?: WebGLTexture[] }
    | { kind: 'speedLine'; f: FxSpeedLine; tex: WebGLTexture }
    | { kind: 'uiCommon'; f: FxUICommonLayer; tex: WebGLTexture[] }
  /** 粒子系統的畫法：plain＝粒子 shader、flow＝UI_CommonFlow、flow1＝UI/Flow1（材質的 flow／flow1，見 gachaFxTypes.ts） */
  type DrawEntry = (
    | { sim: ParticleSim; kind: 'plain'; tex: WebGLTexture }
    | { sim: ParticleSim; kind: 'flow'; flow: CommonFlowTex }
    | { sim: ParticleSim; kind: 'flow1'; tex: WebGLTexture[] }
    | { sim: ParticleSim; kind: 'general'; tex: WebGLTexture[] }
    | { sim: ParticleSim; kind: 'uiCommon'; tex: WebGLTexture[] }
  ) & { /** 拖尾材質的貼圖（系統有 trail 才有） */ trail?: WebGLTexture }
  /** UI_CommonFlow 的三張貼圖（圖層與粒子共用）：沒指定的擾動、遮罩綁 shader 預設 black／white */
  const commonFlowTex = async (p: FxCommonFlowParams): Promise<CommonFlowTex> => ({
    main: await fxTex(p.mainTex, p.vRepeat || !!p.mainRepeatU),
    dst: p.disturbTex ? await fxTex(p.disturbTex, true) : T_BLACK,
    mask: p.mask ? await fxTex(p.mask.tex, p.mask.repeat) : T_WHITE,
  })
  /** UI/Flow1 的八張貼圖（圖層與粒子共用），照 FLOW1_TEX 的順序 */
  const flow1Tex = (p: FxFlow1Params) => Promise.all([p.main, p.colorTex, p.disturb?.tex, p.dissolve?.tex, p.dissolve?.mask, p.mask1?.tex, p.mask2?.tex, p.main2?.tex].map(f1Tex))
  /** UI/Common 的五張貼圖（圖層與粒子共用），照 UIC_TEX 的順序 */
  const uiCommonTex = (c: FxUICommonParams) => Promise.all([c.distort?.tex, c.main, c.alpha?.tex, c.alpha3?.tex, c.grad?.tex].map(f1Tex))
  const [T_BG, drawList, flowTex] = await Promise.all([
    loadTex(opts.background, false),
    Promise.all(order.map(async (s): Promise<DrawEntry> => {
      const base = await baseEntry(s)
      return s.sys.trail ? { ...base, trail: await fxTex(s.sys.trail.material.tex) } : base
    })),
    Promise.all(data.flows.map(async (f): Promise<FlowEntry> => isImage(f)
      ? { kind: 'image', f, tex: await fxTex(f.tex), ...(f.seq ? { seq: await Promise.all(f.seq.sheets.map((x) => fxTex(x))) } : {}) }
      : isSpeedLine(f) ? { kind: 'speedLine', f, tex: f.maskTex ? await fxTex(f.maskTex) : T_WHITE }
      : isUICommon(f) ? { kind: 'uiCommon', f, tex: await uiCommonTex(f) } : isFlow1(f)
      ? { kind: 'flow1', f, tex: await flow1Tex(f) }
      : { kind: 'common', f, ...(await commonFlowTex(f)) })),
  ])
  /** 粒子系統本身的畫法與貼圖（拖尾的貼圖另外接在 trail） */
  async function baseEntry(s: ParticleSim): Promise<DrawEntry> {
    const M = s.sys.material
    if (M.flow) return { sim: s, kind: 'flow', flow: await commonFlowTex(M.flow) }
    if (M.flow1) return { sim: s, kind: 'flow1', tex: await flow1Tex(M.flow1) }
    if (M.general) {
      const g = M.general
      return { sim: s, kind: 'general', tex: await Promise.all([g.noise?.tex, g.main, g.edge?.tex, g.mask1?.tex, g.soft?.tex, g.mask2?.tex].map(f1Tex)) }
    }
    if (M.uiCommon) {
      const c = M.uiCommon
      return { sim: s, kind: 'uiCommon', tex: await uiCommonTex(c) }
    }
    return { sim: s, kind: 'plain', tex: await fxTex(M.tex) }
  }
  const flowParts = splitFlows(flowTex, (e) => e.f)

  /** 裁切矩形（畫布座標）→ scissor（畫面緩衝像素，原點左下，和畫布的 y 朝上同向）；沒有就關掉 */
  function scissor(c: FxClip | undefined) {
    if (!c) { gl.disable(gl.SCISSOR_TEST); return }
    const kx = canvas.width / W, ky = canvas.height / H
    const x0 = Math.floor((c[0] + W / 2) * kx), y0 = Math.floor((c[1] + H / 2) * ky)
    const x1 = Math.ceil((c[2] + W / 2) * kx), y1 = Math.ceil((c[3] + H / 2) * ky)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
  }

  /**
   * 一個粒子系統。材質帶 flow／flow1 的（UI_CommonFlow／UI/Flow1 用到單張貼圖以外的設定，見 gachaFxTypes.ts）改用那支 shader：
   * 粒子四邊形的 UV（0–1 或序列幀那一格）就是 shader 拿到的 UV，頂點色是粒子顏色（Flow1 再乘 tint＝_Color）。每個系統自己換程式、設 uView
   */
  function drawParticles(e: DrawEntry, view: readonly [number, number, number, number], time: number) {
    const sim = e.sim, S = sim.sys, C = S.colorOverLife, Z = S.sizeOverLife, ZS = S.sizeBySpeed, UV = S.uv
    const tint = e.kind === 'flow1' || e.kind === 'general' ? S.material.tint : undefined
    scissor(S.clip)
    // 渲染模式 5（None）：粒子本身不畫，只畫拖尾
    if (S.render.mode !== 5) {
      if (e.kind === 'uiCommon') {
        gl.useProgram(P_UIC); gl.uniform4f(uUic.uView, ...view)
        uiCommonUniformsSet(S.material.uiCommon!, e.tex, time)
      } else if (e.kind === 'general') {
        gl.useProgram(P_GEN); gl.uniform4f(uGen.uView, ...view)
        generalUniformsSet(S.material.general!, e.tex, time)
      } else if (e.kind === 'flow') {
        gl.useProgram(P_FLOW); gl.uniform4f(uFl.uView, ...view)
        flowUniforms(S.material.flow!, e.flow, time, 1)
      } else if (e.kind === 'flow1') {
        gl.useProgram(P_FLOW1); gl.uniform4f(uF1.uView, ...view)
        flow1UniformsSet(S.material.flow1!, e.tex, time)
      } else {
        gl.useProgram(P_PT); gl.uniform4f(uPt.uView, ...view)
        gl.uniform1i(uPt.uTex, 0)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, e.tex)
        gl.uniform1f(uPt.uStr, S.material.strength)
        gl.uniform1f(uPt.uStrA, S.material.strengthAlpha ? S.material.strength : 1)
        gl.uniform1f(uPt.uRot, S.material.texRotate)
        gl.uniform4fv(uPt.uTint, S.material.tint ?? WHITE)
      }
      // Unity 只換目的因子（[_Dst3]／[_Dst]），片段輸出兩種模式相同；canvas 是 alpha:false，畫面緩衝的 alpha 不影響頁面合成
      gl.blendFunc(gl.SRC_ALPHA, S.material.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
      const maxPx = (S.render.maxSize || 1) * H
      for (const q of sim.parts) {
        const a = q.age / q.life
        let c = q.col
        if (C) { const g = evalMinMaxGradient(C, a, q.r[0]); c = [c[0] * g[0], c[1] * g[1], c[2] * g[2], c[3] * g[3]] }
        if (tint) c = [c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], c[3] * tint[3]]
        let sx = q.size, sy = q.sizeY
        if (Z) { const k = evalMinMax(Z.x, a, q.r[1]); sx *= k; sy *= Z.y ? evalMinMax(Z.y, a, q.r[1]) : k }
        // 依速度縮放（10-29 補）：這一格的速率，曲線的亂數同 sizeOverLife
        const sp = ZS || UV?.timeMode === 1 ? Math.hypot(...q.vel3) : 0
        if (ZS) { const t = speedT(ZS.range, sp), k = evalMinMax(ZS.x, t, q.r[1]); sx *= k; sy *= ZS.y ? evalMinMax(ZS.y, t, q.r[1]) : k }
        sx = Math.min(sx * UNIT, maxPx); sy = Math.min(sy * UNIT, maxPx)
        const cx = sim.origin[0] + q.pos[0] * UNIT, cy = sim.origin[1] + q.pos[1] * UNIT
        // 序列幀：換成這一格的 UV（材質的主貼圖旋轉 uRot 一樣繞整張的中心，和 Unity 的 shader 拿到的 UV 相同）
        const uv = UV && q.uvr ? uvRect(UV, uvFrame(UV, q.age, q.life, q.uvr, sp)) : FULL_UV
        if (S.render.mode === 1) {
          // 拉伸 billboard：沿速度方向，長度見 GachaFxOptions.streakSpeedBySize
          const vx = q.vel3[0], vy = q.vel3[1], sp = Math.hypot(vx, vy)
          const dx = sp ? vx / sp : 1, dy = sp ? vy / sp : 0
          const raw = opts.streakSpeedBySize !== true
            ? sx * S.render.lengthScale + sp * UNIT * S.render.velocityScale
            : sx * (S.render.lengthScale + sp * S.render.velocityScale)
          const len = Math.min(raw, maxPx * 2) * (opts.streakLength ?? 1)
          const w = (sx / 2) * (opts.streakWidth ?? 1)
          const tx = cx - dx * len, ty = cy - dy * len, nx = -dy * w, ny = dx * w
          quad(tx + nx, ty + ny, cx + nx, cy + ny, cx - nx, cy - ny, tx - nx, ty - ny, c, uv)
        } else {
          // pivot 在粒子旋轉之前移開四邊形；Local 對齊再過系統旋轉的 2×2（見 FxSystem.render）
          const co = Math.cos(q.rot), si = Math.sin(q.rot), hx = sx / 2, hy = sy / 2
          const pv = S.render.pivot, ox = pv ? pv[0] * sx : 0, oy = pv ? pv[1] * sy : 0, A = S.render.align
          const P = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x0, y0]) => {
            const x = x0 + ox, y = y0 + oy, rx = x * co - y * si, ry = x * si + y * co
            return A ? [cx + A[0] * rx + A[1] * ry, cy + A[2] * rx + A[3] * ry] : [cx + rx, cy + ry]
          })
          quad(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1], c, uv)
        }
      }
      flush()
    }
    // 拖尾畫在粒子之後（Unity 的 renderer 先畫粒子、再用第二個材質畫拖尾）
    if (S.trail && e.trail) drawTrails(sim, e.trail, view)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** 一段帶子（兩個三角形），四個頂點各自的位置、UV、顏色：[x, y, u, v, r, g, b, a]，順序 a→b→c→d 繞一圈 */
  function seg(a: number[], b: number[], c: number[], d: number[]) {
    if (vn + FLOATS * 6 > verts.length) { const nv = new Float32Array(verts.length * 2); nv.set(verts); verts = nv }
    for (const p of [a, b, c, a, c, d]) for (let k = 0; k < FLOATS; k++) verts[vn++] = p[k]
  }

  /**
   * 拖尾（FxTrail）：活著的粒子頭接在目前位置、死掉的只剩記下的點；沿拖尾 s＝點的年齡 ÷ 拖尾壽命（0 頭、1 尾）。
   * 寬＝（sizeAffectsWidth 時粒子目前大小）× widthOverTrail(s)，在畫布平面上垂直路徑展開；顏色＝（inheritParticleColor 時粒子目前顏色）
   * × colorOverTrail(s) × colorOverLifetime(粒子年齡比例)。貼圖 u 沿拖尾（textureMode 決定怎麼分，頭＝0；trailUReversed 反過來比較用）、v 橫跨 0–1。
   * 用粒子 shader、拖尾材質（renderer 第二個槽）；z 不管（正交，同粒子）
   */
  function drawTrails(sim: ParticleSim, tex: WebGLTexture, view: readonly [number, number, number, number]) {
    const S = sim.sys, T = S.trail!, M = T.material, C = S.colorOverLife, Z = S.sizeOverLife, now = sim.t
    gl.useProgram(P_PT); gl.uniform4f(uPt.uView, ...view)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uPt.uTex, 0)
    gl.uniform1f(uPt.uStr, M.strength)
    gl.uniform1f(uPt.uStrA, M.strengthAlpha ? M.strength : 1)
    gl.uniform1f(uPt.uRot, M.texRotate)
    gl.uniform4fv(uPt.uTint, M.tint ?? WHITE)
    gl.blendFunc(gl.SRC_ALPHA, M.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    const rev = !!opts.trailUReversed
    for (const q of [...sim.parts, ...sim.orphans]) {
      const tr = q.trail
      if (!tr || !tr.pts.length) continue
      const a = Math.min(q.age / q.life, 1), dead = q.age >= q.life
      let pc = q.col
      if (C) { const g = evalMinMaxGradient(C, a, q.r[0]); pc = [pc[0] * g[0], pc[1] * g[1], pc[2] * g[2], pc[3] * g[3]] }
      const size = q.size * (Z ? evalMinMax(Z.x, a, q.r[1]) : 1) * (S.sizeBySpeed ? evalMinMax(S.sizeBySpeed.x, speedT(S.sizeBySpeed.range, Math.hypot(...q.vel3)), q.r[1]) : 1)
      const lc = evalMinMaxGradient(T.colorOverLifetime, a, tr.r)
      // 點（畫布像素＋時間）：活著的先接上目前位置
      const P: [number, number, number][] = []
      const O = sim.origin
      if (!dead) P.push([O[0] + q.pos[0] * UNIT, O[1] + q.pos[1] * UNIT, now])
      for (const p of tr.pts) {
        const x = O[0] + p[0] * UNIT, y = O[1] + p[1] * UNIT, last = P[P.length - 1]
        if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-3) P.push([x, y, p[3]])
      }
      const n = P.length
      if (n < 2) continue
      const dist = [0]
      for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]))
      const total = dist[n - 1] || 1
      // 每個點的左右兩個頂點
      const L: number[][] = [], R: number[][] = []
      for (let i = 0; i < n; i++) {
        const s = Math.min(1, Math.max(0, (now - P[i][2]) / tr.life))
        const w = (T.sizeAffectsWidth ? size : 1) * evalMinMax(T.widthOverTrail, s, tr.r) * UNIT / 2
        const tc = evalMinMaxGradient(T.colorOverTrail, s, tr.r), base = T.inheritParticleColor ? pc : WHITE
        const col = [0, 1, 2, 3].map((k) => base[k] * tc[k] * lc[k])
        let u = T.textureMode === 0 ? dist[i] / total : T.textureMode === 1 ? dist[i] / UNIT : T.textureMode === 2 ? i / (n - 1) : i
        if (rev && (T.textureMode === 0 || T.textureMode === 2)) u = 1 - u
        const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(n - 1, i + 1)]
        const dx = p0[0] - p1[0], dy = p0[1] - p1[1], dl = Math.hypot(dx, dy) || 1
        const nx = (-dy / dl) * w, ny = (dx / dl) * w
        L.push([P[i][0] + nx, P[i][1] + ny, u, 1, ...col])
        R.push([P[i][0] - nx, P[i][1] - ny, u, 0, ...col])
      }
      for (let i = 0; i < n - 1; i++) seg(R[i], R[i + 1], L[i + 1], L[i])
    }
    flush()
  }

  /** 流動圖層的矩形（兩種 shader 共用）：size 為負＝鏡像，四角的 UV 跟著對調 */
  const QBUF = [0, 0, 0, 0, 0, 0], ABUF = [0], VBUF = [0, 0, 0, 0], EBUF = [0, 0, 0, 0, 0, 0], SBUF = [0, 0, 0, 0, 0, 0, 0, 0]
  /** 逐格軌在 time 的值（每格 stride 個數，在相鄰兩格之間線性內插）寫進 out */
  function track(arr: readonly number[], stride: number, len: number, time: number, out: number[]) {
    const n = arr.length / stride - 1, u = ((time % len) / len) * n, k = Math.min(Math.floor(u), n - 1), w = u - k
    for (let j = 0; j < stride; j++) out[j] = arr[k * stride + j] * (1 - w) + arr[(k + 1) * stride + j] * w
    return out
  }
  /** 圖層這一刻的四角（左下、右下、右上、左上，8 個數，寫在 SBUF）：動畫軌／quad／rot，再加祖先 TweenRot 的旋轉 */
  function layerCorners(f: FxFlow, time: number) {
    const [x, y] = f.pos, hw = f.size[0] / 2, hh = f.size[1] / 2, A = f.anim, P = SBUF
    if (A?.quad || f.quad) {
      const q = A?.quad ? track(A.quad, 6, A.len, time, QBUF) : f.quad!
      P[0] = q[0]; P[1] = q[1]; P[2] = q[2]; P[3] = q[3]; P[4] = q[2] + q[4] - q[0]; P[5] = q[3] + q[5] - q[1]; P[6] = q[4]; P[7] = q[5]
    } else {
      const co = Math.cos(f.rot ?? 0), s = Math.sin(f.rot ?? 0)
      ;[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([dx, dy], k) => { P[2 * k] = x + dx * co - dy * s; P[2 * k + 1] = y + dx * s + dy * co })
    }
    if (f.spin) {
      const [sx, sy] = f.spin.c, a = f.spin.w * time, co = Math.cos(a), si = Math.sin(a)
      for (let k = 0; k < 8; k += 2) {
        const dx = P[k] - sx, dy = P[k + 1] - sy
        P[k] = sx + dx * co - dy * si; P[k + 1] = sy + dx * si + dy * co
      }
    }
    return P
  }
  const FP = [0, 0, 0, 0, 0, 0, 0, 0], FT = [0, 0, 0, 0, 0, 0, 0, 0]
  function flowQuad(f: FxFlow, time: number, uv: readonly number[] = FULL_UV) {
    const [x, y] = f.pos, hw = f.size[0] / 2, hh = f.size[1] / 2
    const A = f.anim
    const c: readonly number[] = A?.alpha ? [f.color[0], f.color[1], f.color[2], track(A.alpha, 1, A.len, time, ABUF)[0]] : f.color
    if (f.fill) {
      // Filled 的 Image（10-29 補）：在 0–1 座標切好，再照四角（平行四邊形）與 uv 範圍換成畫布位置與貼圖座標
      const P = layerCorners(f, time), amt = A?.fill ? track(A.fill, 1, A.len, time, ABUF)[0] : f.fill.amount
      for (const q of fillQuads(f.fill, amt)) {
        for (let k = 0; k < 8; k += 2) {
          const nx = q[k], ny = q[k + 1]
          FP[k] = P[0] + nx * (P[2] - P[0]) + ny * (P[6] - P[0]); FP[k + 1] = P[1] + nx * (P[3] - P[1]) + ny * (P[7] - P[1])
          FT[k] = uv[0] + nx * (uv[2] - uv[0]); FT[k + 1] = uv[1] + ny * (uv[3] - uv[1])
        }
        quadUV(FP, FT, c)
      }
    } else if (f.spin) {
      // 祖先 TweenRot 的旋轉（10-29 補）：四角算好再繞 spin.c 轉（layerCorners）
      const P = layerCorners(f, time)
      quad(P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], c, uv)
    } else if (A?.quad || f.quad) {
      // 平行四邊形（三個角，右上自己補）；有動畫軌就在相鄰兩格之間線性內插
      const q = A?.quad ? track(A.quad, 6, A.len, time, QBUF) : f.quad!
      quad(q[0], q[1], q[2], q[3], q[2] + q[4] - q[0], q[3] + q[5] - q[1], q[4], q[5], c, uv)
    } else if (f.rot) {
      // 平面上轉過的矩形（UV 跟著四角走，貼圖一起轉）：四角對中心轉 rot
      const co = Math.cos(f.rot), s = Math.sin(f.rot)
      const P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => [x + dx * co - dy * s, y + dx * s + dy * co])
      quad(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1], c, uv)
    } else quad(x - hw, y - hh, x + hw, y - hh, x + hw, y + hh, x - hw, y + hh, c, uv)
    flush()
  }

  function drawFlow1(f: FxFlow1, tex: WebGLTexture[], time: number) {
    scissor(f.clip)
    gl.blendFunc(gl.SRC_ALPHA, f.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    flow1UniformsSet(f, tex, time)
    // 片段改的遮罩 1 tiling／offset（UIShaderVariableProxy）取代靜止值
    const A = f.anim
    if (A?.mask1ST) gl.uniform4fv(uF1.uM1ST, track(A.mask1ST, 4, A.len, time, VBUF))
    // 片段改的 _DissolveValue（10-29 補）：換成溶解的常數項（同 flow1Uniforms 的 dissolveC）
    if (A?.dissolveValue) gl.uniform1f(uF1.uDisC, 2 * (0.55 - 1.05 * track(A.dissolveValue, 1, A.len, time, ABUF)[0]))
    flowQuad(f, time)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** FS_GENERAL 的六張貼圖與 uniform；省略的段落換成 shader 裡恰好恆等的值（見 gachaFxTypes.ts 的 FxGeneralParams） */
  function generalUniformsSet(g: FxGeneralParams, tex: WebGLTexture[], time: number) {
    GEN_TEX.forEach((name, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.uniform1i(uGen[name], i) })
    const N = g.noise, E = g.edge, M1 = g.mask1, M2 = g.mask2, SD = g.soft
    const st = (x?: FxTO) => x ?? ST_ID, sp = (x?: [number, number]) => x ?? [0, 0]
    gl.uniform1f(uGen.uTime, time)
    gl.uniform4fv(uGen.uMainST, st(g.mainST)); gl.uniform2fv(uGen.uMainSpeed, sp(g.mainSpeed)); gl.uniform1f(uGen.uMainRot, g.mainRotate ?? 0)
    gl.uniform2fv(uGen.uRB, g.colorRB ?? [0, 0]); gl.uniform4fv(uGen.uMainColor, g.mainColor ?? WHITE); gl.uniform1f(uGen.uCentre, g.centre)
    gl.uniform4fv(uGen.uNoiseST, st(N?.st)); gl.uniform2fv(uGen.uNoiseSpeed, sp(N?.speed)); gl.uniform1f(uGen.uNoiseVal, N?.value ?? 0); gl.uniform1f(uGen.uNoiseU, N?.uOnly ? 1 : 0)
    gl.uniform1f(uGen.uEdgeOn, E ? 1 : 0); gl.uniform4fv(uGen.uEdgeST, st(E?.st)); gl.uniform2fv(uGen.uEdgeSpeed, sp(E?.speed))
    gl.uniform1f(uGen.uEdgeVal, E?.value ?? 0); gl.uniform1f(uGen.uEdgeW, E?.width ?? 0); gl.uniform1f(uGen.uEdgeRev, E?.revert ? 1 : 0); gl.uniform4fv(uGen.uEdgeColor, E?.color ?? WHITE)
    gl.uniform4fv(uGen.uM1ST, st(M1?.st)); gl.uniform2fv(uGen.uM1Speed, sp(M1?.speed)); gl.uniform1f(uGen.uM1Rot, M1?.rotate ?? 0); gl.uniform1f(uGen.uM1Rev, M1?.revert ? 1 : 0)
    gl.uniform4fv(uGen.uM2ST, st(M2?.st)); gl.uniform2fv(uGen.uM2Speed, sp(M2?.speed)); gl.uniform1f(uGen.uM2Rot, M2?.rotate ?? 0); gl.uniform1f(uGen.uM2Rev, M2?.revert ? 1 : 0)
    // 軟溶解省略＝shader 預設（_Float4 0.51、沒貼圖、沒開）：算出來恰好是 1
    gl.uniform4fv(uGen.uSoftST, st(SD?.st)); gl.uniform2fv(uGen.uSoftSpeed, sp(SD?.speed)); gl.uniform1f(uGen.uF4, SD?.float4 ?? 0.51)
    gl.uniform1f(uGen.uSoftOn, SD?.value != null ? 1 : 0); gl.uniform1f(uGen.uSoftVal, SD?.value ?? 0); gl.uniform1f(uGen.uSoftRev, SD?.revert ? 1 : 0)
  }

  /** FS_UI_COMMON 的五張貼圖與 uniform；省略的欄位換成 shader 預設值（見 gachaFxTypes.ts 的 FxUICommonParams） */
  function uiCommonUniformsSet(c: FxUICommonParams, tex: WebGLTexture[], time: number) {
    UIC_TEX.forEach((name, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.uniform1i(uUic[name], i) })
    const D = c.distort, st = (x?: FxTO) => x ?? ST_ID, sp = (x?: [number, number]) => x ?? [0, 0]
    gl.uniform1f(uUic.uTime, time)
    gl.uniform4fv(uUic.uMainST, st(c.mainST)); gl.uniform2fv(uUic.uMainSpeed, sp(c.mainSpeed))
    gl.uniform1f(uUic.uPower, c.power ?? 1); gl.uniform1f(uUic.uInt, c.intensity ?? 1); gl.uniform3fv(uUic.uMainColor, c.mainColor ?? [1, 1, 1])
    gl.uniform4fv(uUic.uAlphaSel, c.alphaSel ?? [0, 0, 0, 1]); gl.uniform1f(uUic.uAll, c.allAlpha ?? 1); gl.uniform1f(uUic.uPA, c.particleAlpha ? 1 : 0)
    gl.uniform4fv(uUic.uDistST, st(D?.st)); gl.uniform2fv(uUic.uDistSpeed, sp(D?.speed)); gl.uniform2fv(uUic.uDistK, D?.k ?? [0, 0])
    gl.uniform1f(uUic.uDMain, D?.main ? 1 : 0); gl.uniform1f(uUic.uDAlpha, D?.alpha ? 1 : 0)
    gl.uniform4fv(uUic.uAlphaST, st(c.alpha?.st)); gl.uniform2fv(uUic.uAlphaSpeed, sp(c.alpha?.speed))
    gl.uniform4fv(uUic.uAlpha3ST, st(c.alpha3?.st)); gl.uniform2fv(uUic.uAlpha3Speed, sp(c.alpha3?.speed))
    gl.uniform4fv(uUic.uGradST, st(c.grad?.st)); gl.uniform2fv(uUic.uGradSpeed, sp(c.grad?.speed))
  }

  /** FS_FLOW1 的七張貼圖與 uniform（圖層與粒子共用） */
  function flow1UniformsSet(f: FxFlow1Params, tex: WebGLTexture[], time: number) {
    FLOW1_TEX.forEach((name, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[i]); gl.uniform1i(uF1[name], i) })
    const u = flow1Uniforms(f)
    gl.uniform1f(uF1.uTime, time)
    gl.uniform1f(uF1.uK, u.k)
    gl.uniform1f(uF1.uVClamp, u.vClamp)
    gl.uniform1f(uF1.uChR, u.channelR)
    gl.uniform1f(uF1.uM1Soft, u.mask1Soft)
    gl.uniform1f(uF1.uM1Rev, u.mask1Rev)
    gl.uniform1f(uF1.uM2Soft, u.mask2Soft)
    gl.uniform1f(uF1.uM2Rev, u.mask2Rev)
    gl.uniform1f(uF1.uDisRev, u.dissolveRev)
    gl.uniform1f(uF1.uDisC, u.dissolveC)
    gl.uniform1f(uF1.uDisSoft, u.dissolveSoft)
    gl.uniform1f(uF1.uMainValue, u.mainValue)
    gl.uniform2fv(uF1.uMainRot, u.mainRot)
    gl.uniform2fv(uF1.uColRot, u.colorRot)
    gl.uniform2fv(uF1.uM1Rot, u.mask1Rot)
    gl.uniform2fv(uF1.uMainFlow, u.mainFlow)
    gl.uniform2fv(uF1.uDstFlow, u.disturbFlow)
    gl.uniform2fv(uF1.uDisFlow, u.dissolveFlow)
    gl.uniform2fv(uF1.uAxis, u.axis)
    gl.uniform2fv(uF1.uDisAxis, u.dissolveAxis)
    gl.uniform4fv(uF1.uMainTO, u.mainTO)
    gl.uniform4fv(uF1.uDstTO, u.disturbTO)
    gl.uniform4fv(uF1.uColST, u.colorST)
    gl.uniform4fv(uF1.uM1ST, u.mask1ST)
    gl.uniform4fv(uF1.uM2ST, u.mask2ST)
    gl.uniform4fv(uF1.uDisST, u.dissolveST)
    gl.uniform4fv(uF1.uDisMaskST, u.dissolveMaskST)
    gl.uniform1f(uF1.uTex2I, u.tex2I)
    gl.uniform1f(uF1.uTex2Pow, u.tex2Pow)
    gl.uniform2fv(uF1.uTex2Flow, u.tex2Flow)
    gl.uniform4fv(uF1.uTex2TO, u.tex2TO)
    gl.uniform4fv(uF1.uTex2ST, u.tex2ST)
  }

  function drawFlow(f: FxCommonFlow, t: CommonFlowTex, time: number) {
    scissor(f.clip)
    // UI_CommonFlow 是 Blend SrcAlpha [_Dst]：疊加（1）照校準乘 FLOW_GAIN；一般透明（10，10-29 起）照 shader 不乘（校準是對疊加的亮度調的）
    gl.blendFunc(gl.SRC_ALPHA, f.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    flowUniforms(f, t, time, f.blend === 'alpha' ? 1 : FLOW_GAIN)
    // 片段改的擾動量、遮罩位移（UIShaderVariableProxy）取代靜止值
    const A = f.anim
    if (A?.disturbValue) gl.uniform1f(uFl.uDstVal, track(A.disturbValue, 1, A.len, time, ABUF)[0] * FLOW_DISTURB_K)
    if (A?.maskTO) gl.uniform4fv(uFl.uMaskTO, track(A.maskTO, 4, A.len, time, VBUF))
    flowQuad(f, time)
    gl.activeTexture(gl.TEXTURE0)
  }

  /**
   * FS_FLOW 的貼圖與 uniform（圖層與粒子共用）；gain：圖層用校準的 FLOW_GAIN，粒子用 1（和粒子 shader 的強度一樣只乘 _MainValue）。
   * ⚠ 待確認（10-29 決定先不改）：流動材質的粒子還沒對過遊戲畫面；如果比遊戲亮，先試粒子也乘 FLOW_GAIN
   */
  function flowUniforms(f: FxCommonFlowParams, t: CommonFlowTex, time: number, gain: number) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t.main); gl.uniform1i(uFl.uMain, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t.dst); gl.uniform1i(uFl.uDst, 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t.mask); gl.uniform1i(uFl.uMask, 2)
    gl.uniform1f(uFl.uTime, time)
    gl.uniform1f(uFl.uMainValue, f.mainValue * gain)
    gl.uniform1f(uFl.uDstVal, f.disturbValue * FLOW_DISTURB_K)
    gl.uniform1f(uFl.uVRepeat, f.vRepeat ? 1 : 0)
    gl.uniform2f(uFl.uDstFlow, f.disturbFlow[0], f.disturbFlow[1])
    gl.uniform4fv(uFl.uMainTO, f.mainTO)
    gl.uniform4fv(uFl.uDstTO, f.disturbTO)
    const mr = f.mainRotate ?? 0, K = f.mask, kr = K?.rotate ?? 0
    gl.uniform4fv(uFl.uMainST, f.mainST ?? ST_ID)
    gl.uniform4fv(uFl.uDstST, f.disturbST ?? ST_ID)
    gl.uniform2f(uFl.uDstAxis, f.disturbV ? 0 : 1, f.disturbV ? 1 : 0)
    gl.uniform2f(uFl.uMainRot, Math.cos(mr), Math.sin(mr))
    gl.uniform2f(uFl.uMainFlow, f.mainFlow?.[0] ?? 0, f.mainFlow?.[1] ?? 0)
    gl.uniform1f(uFl.uRepeatU, f.mainRepeatU ? 1 : 0)
    gl.uniform4fv(uFl.uMaskST, K?.st ?? ST_ID)
    gl.uniform4fv(uFl.uMaskTO, K?.to ?? ST_ID)
    gl.uniform2f(uFl.uMaskRot, Math.cos(kr), Math.sin(kr))
    gl.uniform1f(uFl.uMaskSoft, K?.softness ?? 0)
    gl.uniform1f(uFl.uMaskRev, K?.revert ? 1 : 0)
    gl.uniform1f(uFl.uMaskDst, K?.disturbed ? 1 : 0)
  }

  /** Image＋UIFx_Alpha（FxImage）：粒子 shader 畫一張矩形，整張貼圖、不轉貼圖（矩形本身的旋轉在 flowQuad） */
  function drawImage(f: FxImage, tex: WebGLTexture, time: number, seq?: WebGLTexture[]) {
    scissor(f.clip)
    // 序列幀（10-29 補）：這一刻的幀 → 第幾張圖集的哪一格（圖集上傳時翻過 y，第 0 列在 v 最大的那條）
    let uv: readonly number[] = FULL_UV
    if (f.seq && seq) {
      const S = f.seq, p = time % S.len, per = S.cols * S.rows
      let k = S.keys[1]
      for (let j = 2; j < S.keys.length && S.keys[j] <= p; j += 2) k = S.keys[j + 1]
      tex = seq[Math.floor(k / per)]
      const c = k % per, du = 1 / S.cols, dv = 1 / S.rows, u0 = (c % S.cols) * du, v0 = 1 - (Math.floor(c / S.cols) + 1) * dv
      uv = [u0, v0, u0 + du, v0 + dv]
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uPt.uTex, 0)
    gl.uniform1f(uPt.uStr, f.strength)
    gl.uniform1f(uPt.uStrA, 1)
    gl.uniform1f(uPt.uRot, 0)
    gl.uniform4fv(uPt.uTint, f.tint ?? WHITE)
    gl.blendFunc(gl.SRC_ALPHA, f.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    flowQuad(f, time, uv)
  }

  /** Image＋UI/Common（FS_UI_COMMON，同粒子）：Blend SrcAlpha [_Dst] */
  function drawUICommon(f: FxUICommonLayer, tex: WebGLTexture[], time: number) {
    scissor(f.clip)
    uiCommonUniformsSet(f, tex, time)
    gl.blendFunc(gl.SRC_ALPHA, f.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    flowQuad(f, time)
    gl.activeTexture(gl.TEXTURE0)
  }

  /** Image＋SpeedLine（FS_SPEEDLINE）：Blend SrcAlpha One */
  function drawSpeedLine(f: FxSpeedLine, tex: WebGLTexture, time: number) {
    scissor(f.clip)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uSl.uMask, 0)
    gl.uniform1f(uSl.uTime, time)
    gl.uniform1f(uSl.uRot, f.rotate ?? 0)
    gl.uniform1f(uSl.uU, f.u)
    gl.uniform1f(uSl.uV, f.v)
    gl.uniform1f(uSl.uSpeed, f.speed)
    gl.uniform1f(uSl.uDensity, f.density)
    gl.uniform1f(uSl.uSimple, f.simpleNoise ? 1 : 0)
    gl.uniform1f(uSl.uC1, f.color1)
    gl.uniform1f(uSl.uC2, f.color2)
    gl.uniform1f(uSl.uCW, f.colorWeight)
    gl.uniform1f(uSl.uCS, f.colorScale)
    gl.uniform1f(uSl.uRadial, f.radial ? 1 : 0)
    gl.uniform1f(uSl.uInner, f.maskInner)
    gl.uniform1f(uSl.uOuter, f.maskOuter)
    gl.uniform1f(uSl.uBlur, f.maskBlur)
    gl.uniform1f(uSl.uCustom, f.maskTex ? 1 : 0)
    gl.uniform2fv(uSl.uOff, f.offset)
    gl.uniform4fv(uSl.uST, f.st ?? [1, 1, 0, 0])
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    flowQuad(f, time)
  }

  /** 有 UIShiny 的插畫切片（FS_SHINY）：位置有片段的軌就逐格換 */
  function drawShiny(f: FxImage, tex: WebGLTexture, time: number) {
    const S = f.shiny!, A = f.anim
    scissor(f.clip)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uSh.uTex, 0)
    const factor = A?.shiny ? track(A.shiny, 1, A.len, time, ABUF)[0] : S.factor
    gl.uniform4f(uSh.uShine, factor, S.width, S.softness, S.brightness)
    gl.uniform4fv(uSh.uCorner, A?.shinyCorners ? track(A.shinyCorners, 4, A.len, time, VBUF) : S.corners)
    gl.uniform1f(uSh.uGloss, S.gloss)
    gl.blendFunc(gl.SRC_ALPHA, f.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    flowQuad(f, time)
  }

  /** 一段流動圖層（under 或 over）：照資料順序，各層自己換程式、設混色 */
  function drawFlows(list: readonly FlowEntry[], view: readonly [number, number, number, number], time: number) {
    for (const e of list) {
      if (e.kind === 'image' && e.f.shiny) {
        gl.useProgram(P_SHINY); gl.uniform4f(uSh.uView, ...view)
        drawShiny(e.f, e.tex, time)
      } else if (e.kind === 'uiCommon') {
        gl.useProgram(P_UIC); gl.uniform4f(uUic.uView, ...view)
        drawUICommon(e.f, e.tex, time)
      } else if (e.kind === 'speedLine') {
        gl.useProgram(P_SL); gl.uniform4f(uSl.uView, ...view)
        drawSpeedLine(e.f, e.tex, time)
      } else if (e.kind === 'image') {
        gl.useProgram(P_PT); gl.uniform4f(uPt.uView, ...view)
        drawImage(e.f, e.tex, time, e.seq)
      } else if (e.kind === 'flow1') {
        gl.useProgram(P_FLOW1); gl.uniform4f(uF1.uView, ...view)
        drawFlow1(e.f, e.tex, time)
      } else {
        gl.useProgram(P_FLOW); gl.uniform4f(uFl.uView, ...view)
        drawFlow(e.f, e, time)
      }
    }
  }

  // ── 迴圈 ──
  let raf = 0, time = 0, last = performance.now(), first = true, dead = false
  function frame(now: number) {
    if (dead) return
    // 分頁切回來時 dt 可能是幾分鐘：一格最多走 1/20 秒，不會一口氣噴出一堆粒子
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    time += dt
    for (const s of sims) {
      const A = s.sys.active
      if (A) { const p = time % A.len; s.setActive(A.on.some(([a, b]) => p >= a && p < b)) }
      const mv = s.sys.move
      if (mv) { const d = track(mv.d, 2, mv.len, time, VBUF); s.origin = [s.sys.pos[0] + d[0], s.sys.pos[1] + d[1]] }
      const em = s.sys.emitter
      if (em) {
        const e = track(em.d, 6, em.len, time, EBUF), k = 1 / Math.hypot(e[2], e[3], e[4], e[5])
        s.emitOff = [e[0] / UNIT, e[1] / UNIT, 0]
        s.emitRot = [e[2] * k, e[3] * k, e[4] * k, e[5] * k]
      }
      s.update(dt)
    }

    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindVertexArray(vao)
    const view = [-W / 2, -H / 2, W, H] as const

    gl.disable(gl.BLEND)
    gl.useProgram(P_BG)
    gl.uniform4f(uBg.uView, ...view)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T_BG); gl.uniform1i(uBg.uTex, 0)
    quad(-W / 2, -H / 2, W / 2, -H / 2, W / 2, H / 2, -W / 2, H / 2, [1, 1, 1, 1])
    flush()

    gl.enable(gl.BLEND)
    // 階層在所有 UIParticle 之前的圖層先畫（見檔頭）；每個系統、圖層都自己設混色
    drawFlows(flowParts.under, view, time)
    // 夾在兩組粒子之間的圖層：畫到那組的第一個系統前先畫（組裡的系統全被試作頁隱藏時，迴圈後補畫）
    let g = 0
    for (const e of drawList) {
      for (const eg = e.sim.sys.group ?? 0; g < eg;) drawFlows(flowParts.before[++g] ?? [], view, time)
      drawParticles(e, view, time)
    }
    while (g < flowParts.before.length - 1) drawFlows(flowParts.before[++g] ?? [], view, time)
    drawFlows(flowParts.over, view, time)
    gl.disable(gl.SCISSOR_TEST)   // 下一格的 clear 要清整個畫面

    if (first) { first = false; opts.onFirstFrame?.() }
    raf = requestAnimationFrame(frame)
  }

  const onLost = (e: Event) => { e.preventDefault(); dead = true; cancelAnimationFrame(raf); opts.onLost?.() }
  canvas.addEventListener('webglcontextlost', onLost)
  raf = requestAnimationFrame(frame)

  return {
    destroy() {
      dead = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      if (gl.isContextLost()) return
      for (const t of textures) gl.deleteTexture(t)
      gl.deleteBuffer(vbo); gl.deleteVertexArray(vao)
      for (const p of [P_BG, P_PT, P_FLOW, P_FLOW1, P_GEN, P_UIC, P_SHINY, P_SL]) gl.deleteProgram(p)
      // 鑑賞一關就把 GPU 資源還回去：反覆開關不會累積 context（瀏覽器上限約 16 個）
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
