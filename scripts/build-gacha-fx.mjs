#!/usr/bin/env node
/**
 * 機甲卡池動態（PLAN-042-B Phase J）：把卡池 prefab 的匯出檔瘦身成站上用的資料。
 *
 *   node scripts/build-gacha-fx.mjs <匯出資料夾> --wap 2054 [--dry-run]
 *
 * ── 新增一台的完整流程（站長照抄；第一次要先建 venv，見 scripts/export-gacha-prefab.py 檔頭）──────────
 *   ① 匯出（從陸版封包直接讀，約 5 秒）：
 *        E:\Mecharashi_Data\unitypy-venv\Scripts\python.exe scripts\export-gacha-prefab.py --wap 1011 --out E:\Mecharashi_Data\gacha-export
 *      → E:\Mecharashi_Data\gacha-export\1011\（data.json＋tex\）。不知道哪台有卡池：同一支加 --list。
 *   ② 試跑：node scripts/build-gacha-fx.mjs E:\Mecharashi_Data\gacha-export\1011 --wap 1011 --dry-run
 *      有 ⚠ 就停在這裡——那台要等引擎補功能（J-1／J-2），不要硬上。
 *   ③ 寫入：同一行拿掉 --dry-run → src/data/gachaFx/1011.json＋public/images/game/fx/；npm run dev 開那台的招募插畫全景看動態。
 *   ④ commit（feat，記得 src/data/siteChangelog/）→ npm run push。新貼圖要等 pages-build-deployment 跑完才開網址（CF 會快取 404）。
 *
 * 輸入（<匯出資料夾>＝export-gacha-prefab.py 的產出，格式同 10-16 芬里厄試作）：
 *   data.json   卡池 prefab 的唯讀匯出：{ prefab, nodes[], materials{}, textures{} }（UnityPy typetree，原樣）
 *   tex/        prefab 用到的貼圖（官方檔名 .png，含兩片招募插畫切片——這裡用不到）
 *   芬里厄 10-16 那份在 _local-notes/2026-10/2026-10-16_機甲故事館_規劃/fenrir-proto/；10-17 用匯出腳本重匯，data.json 逐位元組相同。
 *
 * 輸出：
 *   src/data/gachaFx/<wap>.json        瘦身後的粒子／流動圖層參數（912 KB → 約 40 KB）
 *   public/images/game/fx/<貼圖>.png    特效貼圖，扁平、官方檔名（多台共用的煙霧、火花只放一份）
 *   背景不輸出：站上已有拼好的招募插畫（mechs/<wap>/card/，F 段上站），兩片 RawImage 拼起來就是它。
 *
 * ── 瘦身規則 ──────────────────────────────────────────────────────────────
 * 只留 src/components/lore/gacha/gachaFxEngine.ts 會讀的欄位（型別見 gachaFxTypes.ts）。關掉的模組整個不輸出；
 * 曲線只留 time／value／inSlope／outSlope；MinMaxCurve／MinMaxGradient 只留該模式用得到的那幾個；數字取 6 位有效數字。
 *
 * ── 引擎不支援的東西會印出 ⚠ ──────────────────────────────────────────────
 * 試作只實作了芬里厄用到的功能（UIFx_Alpha／UI_CommonFlow、球／圓錐形狀、拉伸 billboard…），10-17 補了透明混色（_Dst3＝10）、
 * 序列幀（UVModule 的 Grid 模式、依壽命／依 fps）、流動圖層照 shader 規格的選填貼圖、主貼圖 tiling／旋轉／捲動與遮罩（見 UI_CommonFlow 的規格），
 * 以及祖先的位移／旋轉／縮放、錨點與 RectMask2D 裁切（見「版面」）。
 * 下一台若用到拖尾、Flow1、序列幀的其他模式等，這裡會列出來——那是 J-1／J-2 要補的引擎功能，不要硬上。
 * 10-17 對 60 台單機卡池批次試跑（匯出全部 + 本腳本 --dry-run）：0 ⚠ 有 23 台＝2054、1011、1012、2017、2019、2022、3005、3017
 * （以上透明混色就解開）＋1014、2042、2302（序列幀解開）＋1027、1040、1301（流動圖層缺擾動貼圖、遮罩、捲動解開）
 * ＋2071、3006、3019（不發射的系統略過就解開，見 isSilent；60 台共略過 37 個）＋1017、1034、2003、2047、2050、2052（累積祖先的變換解開）。
 * 剩下 37 台卡最多的是 Flow1 20、Box 18、其他 shader 12、流動材質當粒子 7、startDelay 7；
 * 只差一種的 14 台：Box 4、Flow1 4、startDelay 2、拖尾／流動材質當粒子／其他 shader（3010 的 UI_General）／Image 用 UIFx_Alpha 各 1。
 * 逐台清單在 _local-notes/2026-10/2026-10-17_卡池動態_祖先位移/（更早的版本在同月的「不發射系統略過」「批次上站」「流動圖層預設貼圖」「序列幀」夾）。
 * 「·」開頭的是提示不是 ⚠（例：官方沒指定材質、或 emission 關又沒有 burst 的粒子會略過），照常可以上站。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const srcDir = args.find((a) => !a.startsWith('--'))
const wap = args[args.indexOf('--wap') + 1]
const dryRun = args.includes('--dry-run')
if (!srcDir || !args.includes('--wap') || !/^\d+$/.test(wap ?? '')) {
  console.error('用法：node scripts/build-gacha-fx.mjs <匯出資料夾> --wap <機甲遊戲 ID，例 2054> [--dry-run]')
  process.exit(1)
}

const D = JSON.parse(readFileSync(join(srcDir, 'data.json'), 'utf8'))
const warnings = []
const warn = (msg) => warnings.push(msg)
/** 不影響畫面、只是讓人知道的事（例：略過官方沒指定材質的粒子）：印成「·」，不算 ⚠ */
const notes = []
const note = (msg) => notes.push(msg)

// ── 數值 ──────────────────────────────────────────────────────────────────
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toPrecision(6)) : 0)
const vec3 = (v) => [num(v?.x), num(v?.y), num(v?.z)]
const rgba = (c) => [num(c?.r), num(c?.g), num(c?.b), num(c?.a)]

/** 斜率無限大（Unity 的階梯關鍵影格）存成 null：JSON 存不了 Infinity */
const slope = (x) => (Number.isFinite(x) ? num(x) : null)
const curve = (c) => (c?.m_Curve ?? []).map((k) => [num(k.time), num(k.value), slope(k.inSlope), slope(k.outSlope)])

/** MinMaxCurve：0 常數、1 曲線、2 兩條曲線之間隨機、3 兩個常數之間隨機 */
function minMax(c) {
  if (c == null) return { mode: 0, scalar: 0 }
  if (typeof c === 'number') return { mode: 0, scalar: num(c) }
  const out = { mode: c.minMaxState, scalar: num(c.scalar) }
  if (c.minMaxState === 1 || c.minMaxState === 2) out.maxCurve = curve(c.maxCurve)
  if (c.minMaxState === 2) { out.minCurve = curve(c.minCurve); if (c.minScalar != null) out.minScalar = num(c.minScalar) }
  if (c.minMaxState === 3) out.minScalar = num(c.minScalar)
  return out
}

/** Unity Gradient：key0–7 只有前 m_NumColorKeys／m_NumAlphaKeys 個有效；時間是 0–65535 */
function gradient(G) {
  const colors = [], alphas = []
  for (let i = 0; i < G.m_NumColorKeys; i++) { const k = G['key' + i]; colors.push([num(G['ctime' + i] / 65535), num(k.r), num(k.g), num(k.b)]) }
  for (let i = 0; i < G.m_NumAlphaKeys; i++) alphas.push([num(G['atime' + i] / 65535), num(G['key' + i].a)])
  return G.m_Mode === 1 ? { fixed: true, colors, alphas } : { colors, alphas }
}

/** MinMaxGradient：0 單色、1 漸層、2 兩色之間隨機、3 兩條漸層之間隨機、4 漸層上隨機取色 */
function minMaxGradient(g) {
  if (!g) return { mode: 0, maxColor: [1, 1, 1, 1] }
  const out = { mode: g.minMaxState }
  if (g.minMaxState === 0 || g.minMaxState === 2) out.maxColor = rgba(g.maxColor)
  if (g.minMaxState === 2) out.minColor = rgba(g.minColor)
  if (g.minMaxState === 1 || g.minMaxState === 3 || g.minMaxState === 4) out.maxGradient = gradient(g.maxGradient)
  if (g.minMaxState === 3) out.minGradient = gradient(g.minGradient)
  return out
}

// ── 節點樹 ────────────────────────────────────────────────────────────────
const nodes = D.nodes
const ancestors = (n) => { const out = []; for (let p = n.parent; p != null; p = nodes[p].parent) out.push(nodes[p]); return out }
/** 自己與所有祖先都 active 才會畫 */
const isActive = (n) => n.active !== false && ancestors(n).every((a) => a.active !== false)

// ── 版面：錨點、pivot 與祖先的變換（10-17 J-1 補）──────────────────────────────
/**
 * 每個節點在畫布上的變換（3×3 線性部分 M＋位移 t；畫布座標＝prefab 根節點的座標系，原點在正中央、y 朝上）與矩形大小。
 *   RectTransform：localPosition.xy＝父矩形裡錨點的參考點（anchorMin～anchorMax 依自己的 pivot 內插）＋anchoredPosition，
 *     z 在 m_LocalPosition（它的 xy 序列化成 0，不能拿來用）；矩形大小＝父矩形×(anchorMax−anchorMin)＋sizeDelta。
 *   一般 Transform（Rex、Ranger 的 Particle_MainGlow 等）沒有錨點：直接用 m_LocalPosition，大小當 0。
 * 再一路乘上祖先的位移、旋轉、縮放。根節點自己的變換不算；它的大小照 LayoutElement 的 preferred（60 台都是 2500×1080，
 * 遊戲裡由版面配置撐開，有的台 sizeDelta 是 0），只影響拉伸錨點的子孫（例：撐滿的 RectMask2D）。
 * 祖先的縮放離 1 不到 0.1% 當成 1：那是編輯器拖出來的殘值（1040 螣蛇的 1.00026／0.9999），位置差不到 0.3 px，
 * 照算的話已上站的 JSON 會白白跟著跳。
 * 10-17 前引擎假設祖先都在畫布中央、沒有變換（位置＝自己的 anchoredPosition），有祖先位移的 18 台因此都報 ⚠。
 */
const CANVAS = [2600, 1080]
const Q_ID = [0, 0, 0, 1]
const M_ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const qArr = (q) => (q ? [q.x, q.y, q.z, q.w ?? 1] : Q_ID)
/** 四元數乘法 a·b（先 b 再 a）；a 是單位四元數時結果逐位元等於 b */
const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qMat = ([x, y, z, w]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
]
const mMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
const mApply = (A, v) => A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
const near1 = (s) => (Math.abs(s - 1) < 1e-3 ? 1 : s)
/** 有沒有旋轉（x／y／z 任一分量；試作的門檻） */
const isRotated = (q) => Math.abs(q[0]) > 1e-4 || Math.abs(q[1]) > 1e-4 || Math.abs(q[2]) > 1e-4

/**
 * RectMask2D：遊戲裡 UIParticle 與 Image 都是 MaskableGraphic，會被祖先的 RectMask2D 裁成矩形（同一個節點上的不算，照 Unity 的
 * MaskUtilities；巢狀的取交集；矩形取四角的外接框，Unity 也是這樣）。10-17 盤點 60 台有 28 台的粒子在 RectMask2D 底下，
 * 多半就是根節點那麼大（2500×1080）：只有切進根節點矩形（＝遊戲畫面）的那幾邊才裁，輸出 clip、引擎用 scissor
 * （例：2052 裁決者的 Particle_Wind 只在左半邊的遮罩裡）。站上的插畫是 2600 寬，左右各多露出 50 px 遊戲看不到的部分，
 * 那裡照沒有遮罩的台處理、不裁——照字面裁在 ±1250 會在插畫上切出一條直線（2071、3005 就是這種）。
 * softness（邊緣羽化）與 padding 60 台都沒用到：softness 報 ⚠、padding 照算。
 */
const ROOT_LE = (nodes[0].mb ?? []).find((m) => m.script === 'LayoutElement')?.fields
const layout = []
for (const [i, n] of nodes.entries()) {
  const r = n.rect
  if (n.parent == null) {
    const sd = r?.m_SizeDelta ?? { x: 0, y: 0 }
    layout[i] = {
      M: M_ID, t: [0, 0, 0], q: Q_ID, pivot: [r?.m_Pivot?.x ?? 0.5, r?.m_Pivot?.y ?? 0.5],
      size: [ROOT_LE?.m_PreferredWidth > 0 ? ROOT_LE.m_PreferredWidth : sd.x, ROOT_LE?.m_PreferredHeight > 0 ? ROOT_LE.m_PreferredHeight : sd.y],
      clipKids: null,
    }
    continue
  }
  const P = layout[n.parent]
  let lp, size, pivot
  if (r?.m_AnchorMin) {
    const x0 = -P.pivot[0] * P.size[0], y0 = -P.pivot[1] * P.size[1]
    const ax0 = x0 + P.size[0] * r.m_AnchorMin.x, ax1 = x0 + P.size[0] * r.m_AnchorMax.x
    const ay0 = y0 + P.size[1] * r.m_AnchorMin.y, ay1 = y0 + P.size[1] * r.m_AnchorMax.y
    pivot = [r.m_Pivot.x, r.m_Pivot.y]
    size = [ax1 - ax0 + r.m_SizeDelta.x, ay1 - ay0 + r.m_SizeDelta.y]
    lp = [ax0 + (ax1 - ax0) * pivot[0] + r.m_AnchoredPosition.x, ay0 + (ay1 - ay0) * pivot[1] + r.m_AnchoredPosition.y, r.m_LocalPosition?.z ?? 0]
  } else {
    const p = r?.m_LocalPosition ?? { x: 0, y: 0, z: 0 }
    lp = [p.x, p.y, p.z]
    size = [0, 0]
    pivot = [0.5, 0.5]
  }
  const q = qArr(r?.m_LocalRotation), s = r?.m_LocalScale ?? { x: 1, y: 1, z: 1 }
  const sc = [near1(s.x), near1(s.y), near1(s.z)]
  const M = mMul(P.M, qMat(q).map((row) => row.map((v, j) => v * sc[j])))
  const t = mApply(P.M, lp).map((v, k) => v + P.t[k])
  const L = { M, t, q: qMul(P.q, q), size, pivot, parent: P, clip: P.clipKids, clipKids: P.clipKids }
  const rm = (n.mb ?? []).find((m) => m.script === 'RectMask2D' && m.fields?.m_Enabled !== 0)
  if (rm) {
    const pad = rm.fields.m_Padding ?? { x: 0, y: 0, z: 0, w: 0 }
    const x0 = -pivot[0] * size[0] + pad.x, x1 = (1 - pivot[0]) * size[0] - pad.z
    const y0 = -pivot[1] * size[1] + pad.y, y1 = (1 - pivot[1]) * size[1] - pad.w
    const cs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => mApply(M, [x, y, 0]).map((v, k) => v + t[k]))
    const box = [Math.min(...cs.map((c) => c[0])), Math.min(...cs.map((c) => c[1])), Math.max(...cs.map((c) => c[0])), Math.max(...cs.map((c) => c[1]))]
    const prev = P.clipKids
    L.clipKids = {
      box: prev ? [Math.max(box[0], prev.box[0]), Math.max(box[1], prev.box[1]), Math.min(box[2], prev.box[2]), Math.min(box[3], prev.box[3])] : box,
      masks: [...(prev?.masks ?? []), n.name],
      soft: !!(prev?.soft || rm.fields.m_Softness?.x || rm.fields.m_Softness?.y),
    }
  }
  layout[i] = L
}

/**
 * 遮罩的裁切範圍 [x0, y0, x1, y1]（畫布座標）。沒切進根節點矩形的邊（容許半個像素）放到畫布邊上＝那邊不裁；
 * 四邊都沒切到就不輸出 clip，引擎不必 scissor。
 */
const clipped = new Map()
function clipOf(at, owner) {
  const c = at.clip
  if (!c) return null
  const RW = layout[0].size[0] / 2, RH = layout[0].size[1] / 2, W = CANVAS[0] / 2, H = CANVAS[1] / 2, e = 0.5
  const [x0, y0, x1, y1] = c.box
  const box = [x0 > -RW + e ? x0 : -W, y0 > -RH + e ? y0 : -H, x1 < RW - e ? x1 : W, y1 < RH - e ? y1 : H]
  if (box[0] === -W && box[1] === -H && box[2] === W && box[3] === H) return null
  if (c.soft) warn(`${owner}：遮罩 ${c.masks.join('／')}（RectMask2D）有 softness 羽化，引擎裁成硬邊`)
  const key = c.masks.join('／')
  clipped.set(key, { box, n: (clipped.get(key)?.n ?? 0) + 1 })
  return box.map(num)
}

// ── 材質與貼圖 ────────────────────────────────────────────────────────────
const SHADER_PARTICLE = 'ProjectFM/UI/UIFx_Alpha'
const SHADER_FLOW = 'ProjectFM/UI/UI_CommonFlow'
const usedTex = new Set()
/**
 * 貼圖名是空的：引擎照樣會去載（undefined.png），讀不到就整台播不出來，所以一定要報 ⚠。
 * 選填的貼圖（流動圖層的 _DisturbTex、_Mask1）不經過這裡：沒指定時引擎綁 shader 的預設色，見 flowLayer。
 */
const useTex = (name, owner) => {
  if (!name) { warn(`${owner} 是空的，引擎會載入失敗、整台播不出來`); return name }
  if (!D.textures[name]) warn(`貼圖 ${name} 不在匯出的 textures 清單裡`)
  usedTex.add(name)
  return name
}

// ── UI_CommonFlow 的規格（10-17 用系統的 D3DCompiler_47 反組譯 shader_abs.b 的 D3D11 編譯碼，屬性預設值讀 m_PropInfo）──────
// 詳細公式與反組譯檔在 _local-notes/2026-10/2026-10-17_卡池動態_流動圖層預設貼圖/。引擎實作了的：主貼圖的 tiling（TRANSFORM_TEX）→
// 以 0.5 為中心旋轉 _MainTexRotate（擾動圖的 UV 也跟著轉）→ 擾動 → ＋時間×_Tex1Flow → _MainTex1TO（以 0.5 為中心）；
// 遮罩 _Mask1：r×a 經 _Mask1Softness 的 smoothstep（可反轉）乘進 alpha。沒指定的貼圖用 shader 預設：_DisturbTex＝black、_Mask1＝white。
const ST_ID = [1, 1, 0, 0]
/** 材質貼圖槽的 tiling／offset（m_TexEnvs 的 scale＋offset），沒指定貼圖時 [1,1,0,0] */
const texST = (te) => (te ? [num(te.scale[0]), num(te.scale[1]), num(te.offset[0]), num(te.offset[1])] : ST_ID)
const isIdentityST = (v) => v.every((x, i) => x === ST_ID[i])
/** Unity TextureWrapMode 0＝Repeat（匯出的 textures[].wrap，10-17 起才有） */
const repeats = (tex) => D.textures[tex]?.wrap?.[0] === 0

/** 兩條路徑都沒做的開關（60 台都是 0）：_ModeCtrl＝1 改由粒子 Custom Data 控制位移／擾動／遮罩，_ChannelChoose＝1 只取主貼圖 R 通道 */
function flowUnsupported(m, owner) {
  if (m.floats._ModeCtrl) warn(`${owner} 的 _ModeCtrl＝${m.floats._ModeCtrl}（粒子 Custom Data 控制），引擎不支援`)
  if (m.floats._ChannelChoose) warn(`${owner} 的 _ChannelChoose＝${m.floats._ChannelChoose}（只取 R 通道），引擎不支援`)
}

/** 粒子材質：UIFx_Alpha 直接用；UI_CommonFlow 當粒子材質時只取主貼圖、亮度與旋轉（試作的做法，芬里厄的日蝕光環），其餘功能用到就報 ⚠ */
function particleMaterial(name, owner) {
  // 官方沒指定材質（各台的 Particle_SSR／Particle_All 常見，匯出存 null）：遊戲裡也畫不出東西，直接略過
  if (name == null) { note(`${owner}：官方沒指定材質，略過`); return null }
  const m = D.materials[name]
  if (!m) { warn(`${owner}：找不到材質 ${name}`); return null }
  if (m.shader !== SHADER_PARTICLE && m.shader !== SHADER_FLOW) warn(`${owner}：材質 ${name} 的 shader ${m.shader} 引擎不支援`)
  const isFlow = m.shader === SHADER_FLOW
  // 混色看 shader 的 Blend 狀態（shader_abs.b，10-17 查證）：UIFx_Alpha＝Blend SrcAlpha [_Dst3]、UI_CommonFlow＝Blend SrcAlpha [_Dst]，
  // 值是 Unity 的 BlendMode：1＝One（疊加，預設）、10＝OneMinusSrcAlpha（一般透明）。_SrcBlend／_DstBlend 不是這兩個 shader 的屬性
  // （換 shader 前的殘值），不能拿來判斷；材質沒存的屬性＝shader 預設值（稀疏材質，例：Rex 的 Glow_01）。
  // 透明的材質多半是碎石、煙霧、花瓣：貼圖 RGB 近白、形狀在 alpha，疊加會變成發光的白斑。
  // 沒存時的預設：UI_CommonFlow 的 _Dst＝10、UIFx_Alpha 的 _Dst3＝1（m_PropInfo；10-17 盤點 60 台沒有缺這兩個屬性的材質）
  const dst = (isFlow ? (m.floats._Dst ?? 10) : (m.floats._Dst3 ?? 1))
  if (dst !== 1 && dst !== 10) warn(`${owner}：材質 ${name} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  if (isFlow) {
    flowUnsupported(m, `${owner}：材質 ${name}`)
    const gaps = []
    if (m.tex._Mask1?.tex) gaps.push('遮罩 _Mask1')
    if (m.colors._Tex1Flow?.[0] || m.colors._Tex1Flow?.[1]) gaps.push('主貼圖捲動 _Tex1Flow')
    if (!isIdentityST(texST(m.tex._MainTex)) || !isIdentityST((m.colors._MainTex1TO ?? ST_ID).map(num))) gaps.push('主貼圖 tiling／位移')
    if (m.floats._DisturbValue) gaps.push('擾動')
    if (gaps.length) warn(`${owner}：材質 ${name}（UI_CommonFlow）當粒子材質，引擎只取主貼圖、亮度與旋轉，${gaps.join('、')}會被忽略`)
  }
  const tex = (m.tex._Tex ?? m.tex._MainTex)?.tex
  return {
    tex: useTex(tex, `${owner}：材質 ${name} 的主貼圖`),
    strength: num(isFlow ? (m.floats._MainValue ?? 1) : (m.floats._Color_Str ?? 1)),
    texRotate: num(isFlow ? ((m.floats._MainTexRotate || 0) * Math.PI) / 180 : 0),
    // 疊加是預設、不輸出（既有的 JSON 不變）
    ...(dst === 10 ? { blend: 'alpha' } : {}),
  }
}

// ── 序列幀（UVModule＝Texture Sheet Animation）────────────────────────────────
/**
 * 只支援 Grid 模式、依壽命／依 fps；其餘情況報 ⚠、不輸出（引擎照舊畫整張貼圖）。
 * 10-17 盤點 60 台開著的 102 個：全是 Grid、依壽命 101／依 fps 1、單列的 19 個全是隨機列、沒有翻轉。
 * frameOverTime／startFrame 是 Unity 存的正規化值（0–1，×格數＝幀號；Inspector 顯示的是 ×格數之後），原樣輸出。
 */
function uvModule(U, owner) {
  if (U.mode !== 0) { warn(`${owner}：序列幀是 Sprites 模式（mode ${U.mode}），引擎只支援 Grid`); return null }
  if (U.timeMode !== 0 && U.timeMode !== 2) { warn(`${owner}：序列幀的時間模式 ${U.timeMode}（依速度）引擎不支援`); return null }
  if (U.animationType === 1 && U.rowMode !== 0 && U.rowMode !== 1) warn(`${owner}：序列幀單列的列模式 ${U.rowMode}（依網格索引）引擎不支援，當成第 ${U.rowIndex ?? 0} 列`)
  if (U.flipU || U.flipV) warn(`${owner}：序列幀有翻轉（flipU ${U.flipU}／flipV ${U.flipV}），引擎忽略`)
  if (U.startFrame?.minMaxState === 1 || U.startFrame?.minMaxState === 2) warn(`${owner}：序列幀的 startFrame 是曲線，引擎取曲線起點`)
  const single = U.animationType === 1
  return {
    tilesX: Math.max(1, U.tilesX), tilesY: Math.max(1, U.tilesY), animationType: single ? 1 : 0,
    ...(single ? { rowMode: U.rowMode === 1 ? 1 : 0, rowIndex: U.rowIndex ?? 0 } : {}),
    timeMode: U.timeMode,
    ...(U.timeMode === 0 ? { frameOverTime: minMax(U.frameOverTime), cycles: num(U.cycles ?? 1) } : { fps: num(U.fps) }),
    startFrame: minMax(U.startFrame),
  }
}

// ── 粒子系統 ──────────────────────────────────────────────────────────────
/** 引擎實作了的模組；其他模組開著就提醒（UVModule 支援一部分，細項在 uvModule() 裡檢查） */
const SUPPORTED_MODULES = new Set(['InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'RotationModule', 'ColorModule', 'VelocityModule', 'ForceModule', 'ClampVelocityModule', 'NoiseModule', 'UVModule'])
/** 0 球、4 圓錐、8 圓錐體積 */
const SUPPORTED_SHAPES = new Set([0, 4, 8])

/**
 * 不發射的系統：emission 關、又沒有 burst（各台的 Particle_All／FU／Centre 容器、Glow06 的 Particle 外框常見）。
 * 遊戲裡一顆粒子都不會出，比照「官方沒指定材質」略過——它的 shader、主貼圖、形狀都不必報 ⚠。
 * 不能看 renderer 的 m_Enabled：UI 粒子由 UIParticle 代畫，已上站各台的 renderer 幾乎都是 m_Enabled:false。
 * 例外是 sub-emitter 的目標（由父系統觸發，不靠自己的 emission）：匯出檔的節點沒有元件 pid，對不出 subEmitters[].emitter
 * 指的是誰，所以整個 prefab 有開著的 SubModule 就一律不略過（10-17 盤點 60 台：一個都沒有）。
 */
const hasSubEmitters = nodes.some((n) => n.ps?.SubModule?.enabled && (n.ps.SubModule.subEmitters ?? []).length)
const isSilent = (p) => !hasSubEmitters && !p.EmissionModule?.enabled && !((p.EmissionModule?.m_BurstCount ?? 0) > 0)

function particleSystem(n, at) {
  const p = n.ps, r = n.rect, psr = n.psr
  if (isSilent(p)) { note(`${n.name}：emission 關、沒有 burst，不發射粒子，略過`); return null }
  for (const [k, v] of Object.entries(p)) if (v && typeof v === 'object' && v.enabled && k.endsWith('Module') && !SUPPORTED_MODULES.has(k)) warn(`${n.name}：${k} 開著，引擎不支援（會被忽略）`)
  if (psr.m_RenderMode !== 0 && psr.m_RenderMode !== 1) warn(`${n.name}：渲染模式 ${psr.m_RenderMode} 引擎不支援（只有 billboard 0／拉伸 1）`)
  if (num(p.startDelay?.scalar) !== 0 || p.startDelay?.minMaxState) warn(`${n.name}：有 startDelay，引擎忽略`)
  const I = p.InitialModule, E = p.EmissionModule, S = p.ShapeModule
  const material = particleMaterial(psr.materials?.[0], n.name)
  if (!material) return null
  const clip = clipOf(at, n.name)
  const sys = {
    name: n.name,
    // 位置與旋轉都是累積了祖先之後的（見「版面」）；祖先都沒有變換時＝自己的 anchoredPosition／localRotation，逐位元相同
    pos: [num(at.t[0]), num(at.t[1])],
    rot: at.q.map(num),
    // scalingMode 1＝Local：粒子只跟著自己的 localScale 縮放（祖先的縮放只影響位置，Unity 也是）；其他模式試作當 1
    scale: p.scalingMode === 1 ? vec3(r.m_LocalScale) : [1, 1, 1],
    order: psr.m_SortingOrder || 0,
    ...(clip ? { clip } : {}),
    render: { mode: psr.m_RenderMode, lengthScale: num(psr.m_LengthScale), velocityScale: num(psr.m_VelocityScale), maxSize: num(psr.m_MaxParticleSize) },
    material,
    duration: num(p.lengthInSec),
    looping: !!p.looping,
    prewarm: !!p.prewarm,
    simSpeed: num(p.simulationSpeed || 1),
    initial: {
      lifetime: minMax(I.startLifetime),
      speed: minMax(I.startSpeed),
      size: minMax(I.startSize),
      ...(I.size3D ? { sizeY: minMax(I.startSizeY) } : {}),
      maxParticles: I.maxNumParticles,
      rotation: minMax(I.startRotation),
      color: minMaxGradient(I.startColor),
      gravity: minMax(I.gravityModifier),
    },
    emission: E.enabled
      ? {
          rate: minMax(E.rateOverTime),
          bursts: (E.m_Bursts ?? []).slice(0, E.m_BurstCount ?? 0).map((b) => ({
            time: num(b.time), count: minMax(b.countCurve), cycles: b.cycleCount ?? 0, interval: num(b.repeatInterval), probability: num(b.probability ?? 1),
          })),
        }
      : null,
  }
  if (S.enabled) {
    if (!SUPPORTED_SHAPES.has(S.type)) warn(`${n.name}：發射形狀 ${S.type} 引擎不支援（當成點）`)
    sys.shape = {
      type: S.type, radius: num(S.radius?.value), thickness: num(S.radiusThickness ?? 1), angle: num(S.angle), length: num(S.length),
      randomDir: num(S.randomDirectionAmount), scale: vec3(S.m_Scale ?? { x: 1, y: 1, z: 1 }), rotation: vec3(S.m_Rotation), position: vec3(S.m_Position),
    }
  }
  const V = p.VelocityModule, F = p.ForceModule, L = p.ClampVelocityModule, N = p.NoiseModule, RM = p.RotationModule, C = p.ColorModule, Z = p.SizeModule, UV = p.UVModule
  if (V?.enabled) sys.velocity = { x: minMax(V.x), y: minMax(V.y), z: minMax(V.z), world: !!V.inWorldSpace }
  if (F?.enabled) sys.force = { x: minMax(F.x), y: minMax(F.y), z: minMax(F.z), world: !!F.inWorldSpace }
  if (L?.enabled) sys.clamp = { magnitude: minMax(L.magnitude), dampen: num(L.dampen) }
  if (N?.enabled) sys.noise = { frequency: num(N.frequency), scroll: minMax(N.scrollSpeed), strength: minMax(N.strength), amount: minMax(N.positionAmount) }
  if (RM?.enabled) sys.rotationOverLife = minMax(RM.curve)
  if (C?.enabled) sys.colorOverLife = minMaxGradient(C.gradient)
  if (Z?.enabled) sys.sizeOverLife = Z.separateAxes ? { x: minMax(Z.curve), y: minMax(Z.y) } : { x: minMax(Z.curve) }
  if (UV?.enabled) { const uv = uvModule(UV, n.name); if (uv) sys.uv = uv }
  return sys
}

// ── 流動圖層（Image＋UI_CommonFlow）─────────────────────────────────────────
/**
 * 溶解貼圖刻意不輸出：10-16 對遊戲畫面校準時，照字面套「噪聲溶解」會整塊閃（每格變化量 7.9 對遊戲 1.5），
 * 關掉溶解才對得上（1.6）。引擎的流動 shader 因此沒有溶解這一段，見 gachaFxEngine.ts。
 */
function flowLayer(n, img, at) {
  const m = D.materials[img.material], f = m.floats, owner = `${n.name}：材質 ${img.material}`
  const r = n.rect, c = img.fields.m_Color, mc = m.colors._Color ?? [1, 1, 1, 1]
  // 矩形：中心＝pivot 換到正中央再過變換；大小＝矩形×自己的縮放×祖先累積的縮放。引擎畫不轉的矩形，祖先有旋轉或鏡像就報 ⚠
  const s = r.m_LocalScale, Mp = at.parent.M
  const k = [Math.hypot(Mp[0][0], Mp[1][0], Mp[2][0]), Math.hypot(Mp[0][1], Mp[1][1], Mp[2][1])]
  const center = mApply(at.M, [(0.5 - at.pivot[0]) * at.size[0], (0.5 - at.pivot[1]) * at.size[1], 0]).map((v, i) => v + at.t[i])
  if (isRotated(at.parent.q)) warn(`${owner}：祖先有旋轉，引擎畫成不轉的矩形`)
  if (Mp[0][0] * Mp[1][1] - Mp[0][1] * Mp[1][0] < 0) warn(`${owner}：祖先有負縮放（鏡像），引擎不翻轉貼圖`)
  const clip = clipOf(at, n.name)
  for (const k of ['_MainTex1TO', '_dIsturbTexTO', '_DisturbFlow']) if (!m.colors[k]) warn(`${owner} 缺 ${k}`)
  // 流動圖層引擎只畫疊加（10-17 盤點 60 台的 UI_CommonFlow 圖層 _Dst 全是 1；沒存時 shader 預設是 10＝透明）
  if ((f._Dst ?? 10) !== 1) warn(`${owner} 的混色 SrcAlpha／${f._Dst ?? '10（預設）'}，流動圖層引擎只畫疊加`)
  flowUnsupported(m, owner)
  const disturbValue = num(f._DisturbValue ?? 0)
  if (disturbValue && !isIdentityST(texST(m.tex._DisturbTex))) warn(`${owner} 的 _DisturbTex 有 tiling／位移，引擎忽略`)
  if (disturbValue && f._ModeCtrl1 === 1 && f._ModeCtrl2 === 1) warn(`${owner} 只沿 V 擾動（_ModeCtrl1／_ModeCtrl2），引擎的擾動只推 U`)
  const mainTex = useTex(m.tex._MainTex?.tex, `${owner} 的 _MainTex`)
  // _DisturbTex 沒指定（1027、1040、1301、3027）：shader 預設 black，引擎綁 1×1 黑貼圖——擾動不是 0，是 _DisturbValue 決定的常數偏移
  const disturbTex = m.tex._DisturbTex?.tex
  const mainST = texST(m.tex._MainTex)
  const rotate = num(((f._MainTexRotate ?? 0) * Math.PI) / 180)
  const mainFlow = [num(m.colors._Tex1Flow?.[0]), num(m.colors._Tex1Flow?.[1])]
  // 主貼圖的 U 沒有被 shader 夾住，超出 0–1 時靠貼圖的 wrap（捲動的 Dissolve02 是 Repeat，各台專屬圖多半 Clamp）
  const uLeaves = mainFlow[0] || mainFlow[1] || rotate || !isIdentityST(mainST)
  if (mainTex && uLeaves && !D.textures[mainTex]?.wrap) warn(`${owner}：匯出檔沒有貼圖 wrap（10-17 前的匯出），請用 export-gacha-prefab.py 重匯`)
  const maskTex = m.tex._Mask1?.tex
  const maskRevert = (f._Mask1Revert2 ?? 0) !== 0
  if (!maskTex && maskRevert) warn(`${owner} 沒有 _Mask1 卻開了反轉遮罩：預設白色反轉後整層透明，遊戲裡看不見`)
  if (maskTex && D.textures[maskTex]?.wrap && D.textures[maskTex].wrap[0] !== D.textures[maskTex].wrap[1]) warn(`${owner} 的 _Mask1 兩軸 wrap 不同，引擎取 U 的`)
  return {
    name: n.name,
    pos: [num(center[0]), num(center[1])],
    size: [num(at.size[0] * s.x * k[0]), num(at.size[1] * s.y * k[1])],
    ...(clip ? { clip } : {}),
    color: [num(c.r * mc[0]), num(c.g * mc[1]), num(c.b * mc[2]), num(c.a * mc[3])],
    mainTex,
    ...(disturbTex ? { disturbTex: useTex(disturbTex, `${owner} 的 _DisturbTex`) } : {}),
    mainValue: num(f._MainValue ?? 1),
    disturbValue,
    vRepeat: (f._VRepeatSwitch ?? 0) > 0.5,
    disturbFlow: [num(m.colors._DisturbFlow?.[0]), num(m.colors._DisturbFlow?.[1])],
    mainTO: (m.colors._MainTex1TO ?? ST_ID).map(num),
    disturbTO: (m.colors._dIsturbTexTO ?? ST_ID).map(num),
    // 以下 10-17 J-1 補的，都是預設值就不輸出（2054 芬里厄全是預設，JSON 不變）
    ...(isIdentityST(mainST) ? {} : { mainST }),
    ...(rotate ? { mainRotate: rotate } : {}),
    ...(mainFlow[0] || mainFlow[1] ? { mainFlow } : {}),
    ...(repeats(mainTex) ? { mainRepeatU: true } : {}),
    ...(maskTex
      ? {
          mask: {
            tex: useTex(maskTex, `${owner} 的 _Mask1`),
            st: texST(m.tex._Mask1),
            to: (m.colors._MaskTex1TO ?? ST_ID).map(num),
            rotate: num(((f._Mask1Rotate ?? 0) * Math.PI) / 180),
            softness: num(f._Mask1Softness ?? 0),
            revert: maskRevert,
            disturbed: (f._MaskModeSwitch ?? 0) !== 0,
            repeat: repeats(maskTex),
          },
        }
      : {}),
  }
}

const systems = [], flows = []
for (const [i, n] of nodes.entries()) {
  if (!isActive(n)) continue
  if (n.ps) { const s = particleSystem(n, layout[i]); if (s) systems.push(s); continue }
  for (const mb of n.mb ?? []) {
    if (!mb.material) continue
    const shader = D.materials[mb.material]?.shader
    if (mb.script === 'Image' && shader === SHADER_FLOW) flows.push(flowLayer(n, mb, layout[i]))
    else if (shader) warn(`${n.name}：${mb.script} 用了材質 ${mb.material}（${shader}），引擎不畫`)
  }
}

const out = { v: 1, prefab: D.prefab, canvas: CANVAS, unit: 100, systems, flows }
const json = JSON.stringify(out)

// ── 輸出 ──────────────────────────────────────────────────────────────────
const dataOut = join(ROOT, 'src/data/gachaFx', `${wap}.json`)
const texDir = join(ROOT, 'public/images/game/fx')
const missing = [...usedTex].filter((t) => !existsSync(join(srcDir, D.textures[t]?.file ?? `tex/${t}.png`)))
for (const t of missing) warn(`貼圖檔 ${t} 不在 ${srcDir}`)

console.log(`${D.prefab} → ${wap}.json：${systems.length} 個粒子系統、${flows.length} 個流動圖層、${usedTex.size} 張貼圖，${(json.length / 1024).toFixed(1)} KB`)
for (const [masks, { box, n }] of clipped) note(`遮罩 ${masks}（RectMask2D）把 ${n} 個系統／圖層裁在 x ${box[0].toFixed(1)}～${box[2].toFixed(1)}、y ${box[1].toFixed(1)}～${box[3].toFixed(1)}`)
for (const n of notes) console.log(`  · ${n}`)
for (const w of warnings) console.log(`  ⚠ ${w}`)
if (dryRun) { console.log('（--dry-run：不寫檔）'); process.exit(0) }

mkdirSync(dirname(dataOut), { recursive: true })
writeFileSync(dataOut, json + '\n')
mkdirSync(texDir, { recursive: true })
for (const t of usedTex) {
  if (missing.includes(t)) continue
  copyFileSync(join(srcDir, D.textures[t]?.file ?? `tex/${t}.png`), join(texDir, `${t}.png`))
}
console.log(`✅ 寫入 src/data/gachaFx/${wap}.json，貼圖 ${usedTex.size - missing.length} 張 → public/images/game/fx/`)
