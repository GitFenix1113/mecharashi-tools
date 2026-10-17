// 機甲卡池動態（PLAN-042-B Phase J）：WebGL2 播放器。只在招募插畫的全景鑑賞裡用，由 GachaFxLive 動態載入。
//
// 畫面＝招募插畫（背景，不混色）＋粒子系統（Unity 的 UIFx_Alpha：Blend SrcAlpha [_Dst3]，預設疊加、材質可指定一般透明）
// ＋流動圖層（UI_CommonFlow 的重寫，一律疊加）。
// 粒子模擬在 gachaFxSim.ts；這裡只管 GL 狀態、貼圖與每格把粒子組成四邊形。
//
// 透明混色和疊加不同，畫的先後會影響結果：系統之間照 sortingOrder、同值照 prefab 階層（＝資料順序），流動圖層在所有粒子之後。
// 這個順序是芬里厄（全疊加、順序無關）時期定的，混用透明的機甲上站前要對遊戲畫面確認。
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

import { evalMinMax, evalMinMaxGradient, makePerlin, ParticleSim, uvFrame, uvRect } from './gachaFxSim'
import type { FxClip, FxFlow, FxTO, GachaFxData } from './gachaFxTypes'

const FLOW_DISTURB_K = 0.1
const FLOW_GAIN = 0.85
const ST_ID: FxTO = [1, 1, 0, 0]

export interface GachaFxOptions {
  /** 招募插畫（2600×1080，與鑑賞模式那張 <img> 同一個網址：瀏覽器已經有快取） */
  background: string
  /** 特效貼圖官方檔名 → 網址 */
  texUrl: (name: string) => string
  /** 第一格畫好了（父層據此淡入，不會先看到一格黑） */
  onFirstFrame?: () => void
  /** GPU 把 context 收回去了（分頁在背景太久、驅動重置…）：父層退回靜態插畫 */
  onLost?: () => void
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

// 粒子（UIFx_Alpha）：rgb×頂點色×顏色強度，alpha＝貼圖 a×頂點 a。uRot＝主貼圖旋轉（UI_CommonFlow 當粒子材質時用）
const FS_PARTICLE = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; uniform float uStr; uniform float uRot; out vec4 o;
void main(){ vec2 uv = vUV - 0.5; float c = cos(uRot), s = sin(uRot); uv = vec2(c*uv.x - s*uv.y, s*uv.x + c*uv.y) + 0.5;
  vec4 t = texture(uTex, uv); o = vec4(t.rgb * vCol.rgb * uStr, t.a * vCol.a); }`

// 流動圖層（UI_CommonFlow）：擾動貼圖捲動、沿 U 推移主貼圖（校準版）；UV 的變換順序與遮罩照 shader；不做溶解（見檔頭）。
// 旋轉的 r＝(cos, sin)，方向照 shader（UV 乘 [[c, s], [−s, c]]）。rot／to 以 0.5 為中心，但寫成「線性部分＋只含 uniform 的常數」：
// 材質是預設值時兩者都恰好是恆等（寫成 (p−0.5)+0.5 會有浮點捨入，fract 接縫上的像素會跳），芬里厄逐像素不變。
const FS_FLOW = `#version 300 es
precision highp float; in vec2 vUV; in vec4 vCol;
uniform sampler2D uMain, uDst, uMask; uniform float uTime, uMainValue, uDstVal, uVRepeat, uRepeatU, uMaskSoft, uMaskRev, uMaskDst;
uniform vec2 uDstFlow, uMainFlow, uMainRot, uMaskRot; uniform vec4 uMainTO, uDstTO, uMainST, uMaskST, uMaskTO; out vec4 o;
vec2 rot(vec2 p, vec2 r){ return vec2(r.x * p.x + r.y * p.y, r.x * p.y - r.y * p.x) + (0.5 - vec2(r.x + r.y, r.x - r.y) * 0.5); }
vec2 to(vec2 p, vec4 t){ return p * t.xy + ((t.zw - 0.5) * t.xy + 0.5); }
void main(){
  float d = texture(uDst, to(rot(vUV, uMainRot) + uTime * uDstFlow, uDstTO)).r;
  float dx = (d - 0.5) * uDstVal;
  vec2 muv = rot(vUV * uMainST.xy + uMainST.zw, uMainRot);
  muv.x += dx;
  muv = to(muv + uTime * uMainFlow, uMainTO);
  muv.x = uRepeatU > 0.5 ? muv.x : clamp(muv.x, 0.0, 1.0);
  muv.y = uVRepeat > 0.5 ? fract(muv.y) : clamp(muv.y, 0.0, 1.0);
  vec4 m = texture(uMain, muv);
  vec2 kuv = rot(vUV * uMaskST.xy + uMaskST.zw, uMaskRot);
  if (uMaskDst > 0.5) kuv.x += dx;
  vec4 k = texture(uMask, to(kuv, uMaskTO));
  float s = clamp((k.r * k.a - uMaskSoft) / (1.0 - 2.0 * uMaskSoft), 0.0, 1.0);
  s = s * s * (3.0 - 2.0 * s);
  if (uMaskRev > 0.5) s = 1.0 - s;
  o = vec4(m.rgb * vCol.rgb * uMainValue, m.a * vCol.a * s);
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
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'shader 連結失敗')
    return p
  }
  const P_BG = program(FS_BG), P_PT = program(FS_PARTICLE), P_FLOW = program(FS_FLOW)
  const U = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]))
  const uBg = U(P_BG, ['uView', 'uTex'])
  const uPt = U(P_PT, ['uView', 'uTex', 'uStr', 'uRot'])
  const uFl = U(P_FLOW, ['uView', 'uMain', 'uDst', 'uMask', 'uTime', 'uMainValue', 'uDstVal', 'uVRepeat', 'uRepeatU', 'uDstFlow', 'uMainFlow',
    'uMainRot', 'uMainTO', 'uDstTO', 'uMainST', 'uMaskST', 'uMaskTO', 'uMaskRot', 'uMaskSoft', 'uMaskRev', 'uMaskDst'])

  const vbo = gl.createBuffer(), vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  // 三支程式的屬性名稱一樣；同一個 VAO 照位置綁一次（各程式的位置不一定相同，所以三支都綁）
  for (const p of [P_BG, P_PT, P_FLOW]) {
    for (const [name, size, off] of [['aPos', 2, 0], ['aUV', 2, 8], ['aCol', 4, 16]] as const) {
      const loc = gl.getAttribLocation(p, name)
      if (loc < 0) continue
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, off)
    }
  }
  let verts = new Float32Array(FLOATS * 6 * 1024), vn = 0
  /** 四角（逆時針：左下、右下、右上、左上）；uv＝貼圖範圍 [u0, v0, u1, v1]，預設整張（序列幀時是那一格，見 uvRect） */
  function quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: readonly number[], uv: readonly number[] = FULL_UV) {
    if (vn + FLOATS * 6 > verts.length) { const nv = new Float32Array(verts.length * 2); nv.set(verts); verts = nv }
    const [u0, v0, u1, v1] = uv
    const P = [[x0, y0, u0, v0], [x1, y1, u1, v0], [x2, y2, u1, v1], [x0, y0, u0, v0], [x2, y2, u1, v1], [x3, y3, u0, v1]]
    for (const q of P) { verts[vn++] = q[0]; verts[vn++] = q[1]; verts[vn++] = q[2]; verts[vn++] = q[3]; verts[vn++] = c[0]; verts[vn++] = c[1]; verts[vn++] = c[2]; verts[vn++] = c[3] }
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
    if (!cache.has(key)) cache.set(key, loadTex(opts.texUrl(name), repeat))
    return cache.get(key)!
  }

  // ── 場景 ──
  const perlin = makePerlin(Math.random)
  const [W, H] = data.canvas, UNIT = data.unit
  // 預熱在建構時跑（每個系統 duration×30 步）
  const sims = data.systems.map((s) => new ParticleSim(s, Math.random, perlin))
  const order = sims.map((s, i) => [s, i] as const).sort((a, b) => a[0].sys.order - b[0].sys.order || a[1] - b[1]).map((x) => x[0])
  const [T_BG, drawList, flowTex] = await Promise.all([
    loadTex(opts.background, false),
    Promise.all(order.map(async (s) => ({ sim: s, tex: await fxTex(s.sys.material.tex) }))),
    Promise.all(data.flows.map(async (f) => ({
      f,
      main: await fxTex(f.mainTex, f.vRepeat || !!f.mainRepeatU),
      dst: f.disturbTex ? await fxTex(f.disturbTex, true) : T_BLACK,
      mask: f.mask ? await fxTex(f.mask.tex, f.mask.repeat) : T_WHITE,
    }))),
  ])

  /** 裁切矩形（畫布座標）→ scissor（畫面緩衝像素，原點左下，和畫布的 y 朝上同向）；沒有就關掉 */
  function scissor(c: FxClip | undefined) {
    if (!c) { gl.disable(gl.SCISSOR_TEST); return }
    const kx = canvas.width / W, ky = canvas.height / H
    const x0 = Math.floor((c[0] + W / 2) * kx), y0 = Math.floor((c[1] + H / 2) * ky)
    const x1 = Math.ceil((c[2] + W / 2) * kx), y1 = Math.ceil((c[3] + H / 2) * ky)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x0, y0, Math.max(0, x1 - x0), Math.max(0, y1 - y0))
  }

  function drawParticles(sim: ParticleSim, tex: WebGLTexture) {
    const S = sim.sys, C = S.colorOverLife, Z = S.sizeOverLife, UV = S.uv
    scissor(S.clip)
    gl.uniform1i(uPt.uTex, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1f(uPt.uStr, S.material.strength)
    gl.uniform1f(uPt.uRot, S.material.texRotate)
    // Unity 只換目的因子（[_Dst3]），片段輸出兩種模式相同；canvas 是 alpha:false，畫面緩衝的 alpha 不影響頁面合成
    gl.blendFunc(gl.SRC_ALPHA, S.material.blend === 'alpha' ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE)
    const maxPx = (S.render.maxSize || 1) * H
    for (const q of sim.parts) {
      const a = q.age / q.life
      let c = q.col
      if (C) { const g = evalMinMaxGradient(C, a, q.r[0]); c = [c[0] * g[0], c[1] * g[1], c[2] * g[2], c[3] * g[3]] }
      let sx = q.size, sy = q.sizeY
      if (Z) { const k = evalMinMax(Z.x, a, q.r[1]); sx *= k; sy *= Z.y ? evalMinMax(Z.y, a, q.r[1]) : k }
      sx = Math.min(sx * UNIT, maxPx); sy = Math.min(sy * UNIT, maxPx)
      const cx = S.pos[0] + q.pos[0] * UNIT, cy = S.pos[1] + q.pos[1] * UNIT
      // 序列幀：換成這一格的 UV（材質的主貼圖旋轉 uRot 一樣繞整張的中心，和 Unity 的 shader 拿到的 UV 相同）
      const uv = UV && q.uvr ? uvRect(UV, uvFrame(UV, q.age, q.life, q.uvr)) : FULL_UV
      if (S.render.mode === 1) {
        // 拉伸 billboard：沿速度方向，長度＝size×lengthScale＋速度×velocityScale
        const vx = q.vel3[0], vy = q.vel3[1], sp = Math.hypot(vx, vy)
        const dx = sp ? vx / sp : 1, dy = sp ? vy / sp : 0
        const len = Math.min(sx * S.render.lengthScale + sp * UNIT * S.render.velocityScale, maxPx * 2), w = sx / 2
        const tx = cx - dx * len, ty = cy - dy * len, nx = -dy * w, ny = dx * w
        quad(tx + nx, ty + ny, cx + nx, cy + ny, cx - nx, cy - ny, tx - nx, ty - ny, c, uv)
      } else {
        const co = Math.cos(q.rot), si = Math.sin(q.rot), hx = sx / 2, hy = sy / 2
        const P = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [cx + x * co - y * si, cy + x * si + y * co])
        quad(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1], c, uv)
      }
    }
    flush()
  }

  function drawFlow(f: FxFlow, main: WebGLTexture, dst: WebGLTexture, mask: WebGLTexture, time: number) {
    scissor(f.clip)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, main); gl.uniform1i(uFl.uMain, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dst); gl.uniform1i(uFl.uDst, 1)
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mask); gl.uniform1i(uFl.uMask, 2)
    gl.uniform1f(uFl.uTime, time)
    gl.uniform1f(uFl.uMainValue, f.mainValue * FLOW_GAIN)
    gl.uniform1f(uFl.uDstVal, f.disturbValue * FLOW_DISTURB_K)
    gl.uniform1f(uFl.uVRepeat, f.vRepeat ? 1 : 0)
    gl.uniform2f(uFl.uDstFlow, f.disturbFlow[0], f.disturbFlow[1])
    gl.uniform4fv(uFl.uMainTO, f.mainTO)
    gl.uniform4fv(uFl.uDstTO, f.disturbTO)
    const mr = f.mainRotate ?? 0, K = f.mask, kr = K?.rotate ?? 0
    gl.uniform4fv(uFl.uMainST, f.mainST ?? ST_ID)
    gl.uniform2f(uFl.uMainRot, Math.cos(mr), Math.sin(mr))
    gl.uniform2f(uFl.uMainFlow, f.mainFlow?.[0] ?? 0, f.mainFlow?.[1] ?? 0)
    gl.uniform1f(uFl.uRepeatU, f.mainRepeatU ? 1 : 0)
    gl.uniform4fv(uFl.uMaskST, K?.st ?? ST_ID)
    gl.uniform4fv(uFl.uMaskTO, K?.to ?? ST_ID)
    gl.uniform2f(uFl.uMaskRot, Math.cos(kr), Math.sin(kr))
    gl.uniform1f(uFl.uMaskSoft, K?.softness ?? 0)
    gl.uniform1f(uFl.uMaskRev, K?.revert ? 1 : 0)
    gl.uniform1f(uFl.uMaskDst, K?.disturbed ? 1 : 0)
    const [x, y] = f.pos, hw = f.size[0] / 2, hh = f.size[1] / 2
    if (f.rot) {
      // 平面上轉過的矩形（UV 跟著四角走，貼圖一起轉）：四角對中心轉 rot
      const c = Math.cos(f.rot), s = Math.sin(f.rot)
      const P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([dx, dy]) => [x + dx * c - dy * s, y + dx * s + dy * c])
      quad(P[0][0], P[0][1], P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1], f.color)
    } else quad(x - hw, y - hh, x + hw, y - hh, x + hw, y + hh, x - hw, y + hh, f.color)
    flush()
    gl.activeTexture(gl.TEXTURE0)
  }

  // ── 迴圈 ──
  let raf = 0, time = 0, last = performance.now(), first = true, dead = false
  function frame(now: number) {
    if (dead) return
    // 分頁切回來時 dt 可能是幾分鐘：一格最多走 1/20 秒，不會一口氣噴出一堆粒子
    const dt = Math.min((now - last) / 1000, 1 / 20)
    last = now
    time += dt
    for (const s of sims) s.update(dt)

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
    gl.useProgram(P_PT)
    gl.uniform4f(uPt.uView, ...view)
    for (const { sim, tex } of drawList) drawParticles(sim, tex)   // 每個系統自己設混色

    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)   // 流動圖層一律疊加；最後一個粒子系統可能把混色留在透明
    gl.useProgram(P_FLOW)
    gl.uniform4f(uFl.uView, ...view)
    for (const { f, main, dst, mask } of flowTex) drawFlow(f, main, dst, mask, time)
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
      for (const p of [P_BG, P_PT, P_FLOW]) gl.deleteProgram(p)
      // 鑑賞一關就把 GPU 資源還回去：反覆開關不會累積 context（瀏覽器上限約 16 個）
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
