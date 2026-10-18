#!/usr/bin/env node
/**
 * 卡池動態（機甲 PLAN-042-B Phase J、機師 PLAN-042-A Phase J）：把卡池 prefab 的匯出檔瘦身成站上用的資料。
 *
 *   node scripts/build-gacha-fx.mjs <匯出資料夾> --wap 2054 [--dry-run]          機甲 → src/data/gachaFx/2054.json
 *   node scripts/build-gacha-fx.mjs <匯出資料夾> --pilot 10103174 [--dry-run]    機師 → src/data/gachaFx/pilots/10103174.json
 *   機師的匯出：export-gacha-prefab.py --kind pilot --id <gameId>（見它的檔頭）。機師與機甲的 prefab 同構
 *   （根節點 2500×1080、兩片招募插畫拼 2600×1080、同一套 shader），以下規則兩邊通用；背景是 pilots/<gameId>/card/ 那張。
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
 * 以及祖先的位移／旋轉／縮放、錨點與 RectMask2D 裁切（見「版面」）、流動圖層的平面旋轉、方塊發射形狀（Box，見 SUPPORTED_SHAPES）、
 * 第二支流動 shader UI/Flow1（圖層照反組譯全做、粒子取單張貼圖與 _Color 色調，見「UI/Flow1 的規格」）、流動圖層的自身鏡像與繪製順序（under）、
 * 粒子系統的延遲啟動（startDelay，只在播放開始時等一次，見 startDelay()）。
 * 下一台若用到拖尾、序列幀的其他模式等，這裡會列出來——那是 J-1／J-2 要補的引擎功能，不要硬上。
 * 10-17 對 61 台單機卡池批次試跑（匯出全部 + 本腳本 --dry-run；2060 彌造者的 prefab 官方拼成 …PoollItemPrefab，後來才補進來）：
 * 0 ⚠ 有 35 台＝2054、1011、1012、2017、2019、2022、3005、3017
 * （以上透明混色就解開）＋1014、2042、2302（序列幀解開）＋1027、1040、1301（流動圖層缺擾動貼圖、遮罩、捲動解開）
 * ＋2071、3006、3019（不發射的系統略過就解開，見 isSilent；60 台共略過 37 個）＋1017、1034、2003、2047、2050、2052（累積祖先的變換解開）
 * ＋2053（方塊形狀解開）＋1028、2027、2055、2060、2061、2070、3014（Flow1 解開）＋2056、3015、3037、3051（startDelay 解開；3015 是 Ranger 卡池，10-19 前誤放在 3032）。
 * 剩下 26 台卡最多的是速度模組的 orbital 等 17、流動材質當粒子 7、Flow1 粒子用到單張貼圖以外的設定 5（2018、2049、2062、3007、3047）；
 * 只差一種的 11 台：orbital 7（1036、1052、1303、2040、2043、3020、3028：1303、3020 是 Flow1 解開後只剩灰燼的 orbitalZ）、
 * TweenAlpha 1（1035：Flow1 解開後只剩這個，見主迴圈後的 Tween 檢查）、流動材質當粒子 1、Image 用 UIFx_Alpha 1、
 * Flow1 粒子 1（2062：startDelay 解開後只剩這個）。
 * 10-19 依 ConfigDataWapGachaPoolInfo 修正卡池鍵對照後補匯三池（Ranger02→3032、SEFAS→1029、Nivequus→1071）：前兩台直接 0 ⚠，
 * 1071 凜騎士卡在 Flow1 粒子的 _Color（雨絲 0.758 灰、Light04 橘光），補上色調（tint）後 0 ⚠——0 ⚠ 共 38 池。
 * 同類的那 5 台都不是卡 _Color，這次一台也沒解開；機師的匯出重掃，10103167 黑障（同一組雨絲材質）因此變成 0 ⚠。
 * 驗證（反組譯依據、逐像素比值、新舊引擎迴歸、全部匯出 dry-run 前後）在 _local-notes/2026-10/2026-10-19_卡池動態_Flow1粒子色調/。
 * 逐台清單在 _local-notes/2026-10/2026-10-17_卡池動態_startDelay/（更早的版本在同月的「剩餘30台」「Flow1」「Box形狀」「祖先位移」「不發射系統略過」「批次上站」「流動圖層預設貼圖」「序列幀」夾）。
 * 「·」開頭的是提示不是 ⚠（例：官方沒指定材質、或 emission 關又沒有 burst 的粒子會略過），照常可以上站。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const srcDir = args.find((a) => !a.startsWith('--'))
// 機甲 --wap、機師 --pilot：只差輸出的位置（機師放 gachaFx/pilots/，與 4 碼 wap 分開，見 gachaFxRegistry.ts）
const isPilot = args.includes('--pilot')
const wap = args[args.indexOf(isPilot ? '--pilot' : '--wap') + 1]
const dryRun = args.includes('--dry-run')
if (!srcDir || (isPilot === args.includes('--wap')) || !/^\d+$/.test(wap ?? '')) {
  console.error('用法：node scripts/build-gacha-fx.mjs <匯出資料夾> --wap <機甲遊戲 ID，例 2054> [--dry-run]')
  console.error('　　　node scripts/build-gacha-fx.mjs <匯出資料夾> --pilot <機師遊戲 ID，例 10103174> [--dry-run]')
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

/** MinMaxCurve 恆為 0（沒用到）：曲線模式只看 scalar（Unity 用它乘曲線）；兩值之間隨機的另一端是 minScalar。寧可多報不漏報 */
const isZeroCurve = (c) => c == null || (num(c.scalar) === 0 && !((c.minMaxState === 2 || c.minMaxState === 3) && num(c.minScalar) !== 0))

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
const SHADER_FLOW1 = 'UI/Flow1'
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

// ── UI/Flow1 的規格（10-17 同樣反組譯 shader_abs.b，詳細公式與 41 個材質的盤點在 _local-notes/2026-10/2026-10-17_卡池動態_Flow1/）──
// 跟 UI_CommonFlow 是同一個 ASE 範本，但不能共用：擾動是往 D 內插（lerp）不是相加、所有貼圖預設 white（含 _DisturbTex）、
// _VRepeatSwitch 預設 1、主貼圖叫 _MainTex1 且沒有 TRANSFORM_TEX、_MainTex 是另外乘上去的顏色貼圖（Image／RawImage 掛的圖會變成它）、
// 遮罩與溶解乘四個通道、_MainValue 也乘 alpha。Blend SrcAlpha [_Dst]（預設 10＝透明）。
// 引擎照公式全做，只有第二張主貼圖 _MainTex2（_Tex2Intensity，41 個材質全是 0）與粒子 Custom Data（_ModeCtrl，全是 0）沒做。
const isWhite = (c) => !c || c.every((x) => x === 1)
/** Flow1 材質裡引擎沒做、或做了也會畫錯的設定：圖層與粒子兩條路徑共用 */
function flow1Unsupported(m, owner) {
  const f = m.floats
  if (f._ModeCtrl) warn(`${owner} 的 _ModeCtrl＝${f._ModeCtrl}（粒子 Custom Data 控制位移／擾動／溶解），引擎不支援`)
  if (f._Tex2Intensity) warn(`${owner} 的 _Tex2Intensity＝${f._Tex2Intensity}（第二張主貼圖 _MainTex2），引擎不支援`)
  for (const k of ['_ChannelChoose', '_ModeCtrl1', '_ModeCtrl2']) if (f[k] != null && f[k] !== 0 && f[k] !== 1) warn(`${owner} 的 ${k}＝${f[k]} 不是 0／1，引擎當成 ${f[k] ? 1 : 0}`)
  if ((f._ColorMask ?? 15) !== 15) warn(`${owner} 的 _ColorMask＝${f._ColorMask}（只寫部分通道），引擎不支援`)
  // 模板：61 台沒有 Mask 元件（只有 RectMask2D），模板緩衝恆為 0，材質的 Ref／Comp 照字面比——2061 螢石的 BGNoise 是 Ref 1、Comp 6.88
  // （Unity 取整數 6＝NotEqual，1≠0 恆通過）。比不過的話遊戲裡畫不出來。
  const comp = Math.trunc(f._StencilComp ?? 8), ref = (f._Stencil ?? 0) & (f._StencilReadMask ?? 255)
  const pass = [true, false, ref < 0, ref === 0, ref <= 0, ref > 0, ref !== 0, ref >= 0, true][comp]
  if (comp !== 8 && comp !== 0 && (hasMask || !pass)) warn(`${owner} 的模板測試 Ref ${f._Stencil}／Comp ${comp}${hasMask ? '（prefab 裡有 Mask 元件）' : '對空的模板緩衝比不過'}，引擎不支援`)
  if (f._StencilOp) warn(`${owner} 的 _StencilOp＝${f._StencilOp}（會寫模板），引擎不支援`)
}
const hasMask = nodes.some((n) => (n.mb ?? []).some((b) => b.script === 'Mask'))
/** 溶解在沒有溶解貼圖／遮罩（＝white）時是常數：照 shader 算出來，1 就等於沒有溶解 */
function dissolveConst(f) {
  const n = f._DissolveMaskRevert ? 0 : 1, soft = f._DissolveSoftness ?? 0
  const x = Math.min(1, Math.max(0, (n + 1.1 - 2.1 * (f._DissolveValue ?? 0) - soft) / (1 - 2 * soft)))
  return Math.min(1, x * x * (3 - 2 * x))
}
const dissolveActive = (m) => !!(m.tex._DissolveTex?.tex || m.tex._DissolveMask?.tex) || dissolveConst(m.floats) < 1
const deg = (d) => num(((d ?? 0) * Math.PI) / 180)

/**
 * UI/Flow1 當粒子材質（2060 彌造者、2070、3014 的閃電與火花）：粒子 UV 就是 0–1（或序列幀那一格），所以 _MainTex1 與 _MainTex
 * 只有一張有指定時，畫面＝那張貼圖 × _Color × 頂點色 × _MainValue（四個通道都乘，輸出 strengthAlpha），沿用粒子 shader。
 * 旋轉的方向跟引擎粒子 shader 的 uRot 相反，換號輸出。主貼圖是 white 時 _ChannelChoose 沒有作用（1303／2060 的 Light02 就是這樣）。
 * _Color（10-19 補，1071 凜騎士的雨絲 0.758 灰、Light04 橘光）：反組譯是 tex(_MainTex) × _Color × 頂點色、再乘主貼圖與 _MainValue，
 * 中間沒有夾值，所以 RGBA 照樣乘、順序無關；輸出 tint，白色不輸出（已上站各台的 JSON 不變）。
 */
function flow1ParticleMaterial(m, name, owner, dst) {
  const f = m.floats, c = m.colors, own = `${owner}：材質 ${name}（UI/Flow1）`
  flow1Unsupported(m, own)
  const main = m.tex._MainTex1?.tex, col = m.tex._MainTex?.tex
  if (main && col) warn(`${own} 的主貼圖 _MainTex1 與顏色貼圖 _MainTex 都有指定，粒子路徑只畫得了一張`)
  const gaps = []
  if (main) {
    if (f._ChannelChoose) gaps.push('只取 R 通道 _ChannelChoose')
    if (c._Tex1Flow?.[0] || c._Tex1Flow?.[1]) gaps.push('主貼圖捲動 _Tex1Flow')
    if (!isIdentityST((c._MainTex1TO ?? ST_ID).map(num))) gaps.push('主貼圖 tiling／位移 _MainTex1TO')
    if (f._DisturbValue) gaps.push('擾動')
  } else if (col && !isIdentityST(texST(m.tex._MainTex))) gaps.push('顏色貼圖 tiling／位移')
  const tex = main ?? col
  const rotate = main ? f._MainTexRotate : f._ColorRotate
  // 轉過的角落會超出 0–1：引擎的粒子貼圖一律夾邊
  if (rotate && tex && repeats(tex)) gaps.push('旋轉後角落的貼圖重複（wrap＝Repeat）')
  if (m.tex._Mask1?.tex || f._Mask1Revert2) gaps.push('遮罩 _Mask1')
  if (m.tex._Mask2?.tex || f._Mask2Revert2) gaps.push('遮罩 _Mask2')
  if (dissolveActive(m)) gaps.push('溶解')
  if (gaps.length) warn(`${own}當粒子材質，引擎只畫一張貼圖 × 顏色 × 強度，${gaps.join('、')}會被忽略`)
  const tint = (c._Color ?? [1, 1, 1, 1]).map(num)
  return {
    tex: useTex(tex, `${own} 的主貼圖（_MainTex1 與 _MainTex 都沒指定）`),
    strength: num(f._MainValue ?? 1),
    texRotate: rotate ? -deg(rotate) : 0,
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    strengthAlpha: true,
    ...(isWhite(tint) ? {} : { tint }),
  }
}

/** 粒子材質：UIFx_Alpha 直接用；UI_CommonFlow 當粒子材質時只取主貼圖、亮度與旋轉（試作的做法，芬里厄的日蝕光環），其餘功能用到就報 ⚠ */
function particleMaterial(name, owner) {
  // 官方沒指定材質（各台的 Particle_SSR／Particle_All 常見，匯出存 null）：遊戲裡也畫不出東西，直接略過
  if (name == null) { note(`${owner}：官方沒指定材質，略過`); return null }
  const m = D.materials[name]
  if (!m) { warn(`${owner}：找不到材質 ${name}`); return null }
  if (m.shader === SHADER_FLOW1) {
    const dst = m.floats._Dst ?? 10
    if (dst !== 1 && dst !== 10) warn(`${owner}：材質 ${name} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
    return flow1ParticleMaterial(m, name, owner, dst)
  }
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
/**
 * 0 球、4 圓錐、5 方塊、8 圓錐體積。
 * 方塊（10-17 J-1 補）：Unity 編輯器的「Emit from」不是另一個欄位，而是 type 本身——5＝Volume（Box）、15＝Shell（BoxShell）、
 * 16＝Edge（BoxEdge），boxThickness 只在 Shell／Edge 才有作用（UnityCsReference 的 ParticleSystemEnums.cs、ShapeModuleUI.cs）。
 * 所以 type 5 不必多輸出欄位：方塊大小就是形狀的 scale（以原點為中心），沿用既有的 scale／rotation／position。
 * Shell／Edge 是 15／16，不在這裡、照舊報 ⚠（10-17 盤點 60 台的 22 個方塊全是 5，boxThickness 全是 0）。
 */
const SUPPORTED_SHAPES = new Set([0, 4, 5, 8])

/**
 * 不發射的系統：emission 關、又沒有 burst（各台的 Particle_All／FU／Centre 容器、Glow06 的 Particle 外框常見）。
 * 遊戲裡一顆粒子都不會出，比照「官方沒指定材質」略過——它的 shader、主貼圖、形狀都不必報 ⚠。
 * 不能看 renderer 的 m_Enabled：UI 粒子由 UIParticle 代畫，已上站各台的 renderer 幾乎都是 m_Enabled:false。
 * 例外是 sub-emitter 的目標（由父系統觸發，不靠自己的 emission）：匯出檔的節點沒有元件 pid，對不出 subEmitters[].emitter
 * 指的是誰，所以整個 prefab 有開著的 SubModule 就一律不略過（10-17 盤點 60 台：一個都沒有）。
 */
const hasSubEmitters = nodes.some((n) => n.ps?.SubModule?.enabled && (n.ps.SubModule.subEmitters ?? []).length)
const isSilent = (p) => !hasSubEmitters && !p.EmissionModule?.enabled && !((p.EmissionModule?.m_BurstCount ?? 0) > 0)

/**
 * startDelay（MainModule 的 Start Delay，10-17 J-1 補）：開始播放後等幾秒才開始跑。依據（筆記 _local-notes/2026-10/2026-10-17_卡池動態_startDelay/）：
 *   單位是秒（Scripting API）；編輯器只給選常數與兩個常數之間隨機（InitialModuleUI 設 m_AllowCurves＝false），隨機的每次播放、
 *   每個系統抽一次（Unity 粒子負責人的論壇回覆）；只在播放開始時等一次——time「不含延遲、在 duration 內循環」、totalTime「含延遲、
 *   不循環」、Play() 從停止狀態開始時才套用延遲（ParticleSystem.bindings.cs 的註解；Cocos 的 Shuriken 移植也註明「第二輪起不延遲（Unity）」）。
 * 61 台 1075 個系統有 15 個開了，全是常數 0.1～2 秒、looping、沒有 prewarm、simulationSpeed 1、祖先的粒子系統都沒有延遲。
 * 沒有依據的組合照舊報 ⚠、不輸出（引擎當成不延遲）：曲線模式；prewarm（編輯器在 prewarm＋looping 時把 Start Delay 反灰，
 * tooltip 說兩者不能並用）；simulationSpeed 不是 1（延遲算不算進倍速沒寫）；祖先的粒子系統也有延遲（子系統要不要跟著等沒寫）。
 */
function startDelay(n) {
  const p = n.ps, d = p.startDelay
  if (isZeroCurve(d)) return null
  const owner = `${n.name}：startDelay ${num(d.minScalar)}～${num(d.scalar)}（模式 ${d.minMaxState}）`
  if (d.minMaxState !== 0 && d.minMaxState !== 3) warn(`${owner} 是曲線，Unity 編輯器不給選、語意沒有依據，引擎忽略`)
  else if (p.prewarm) warn(`${owner} 又開了 prewarm，Unity 編輯器不給並用、語意沒有依據，引擎忽略延遲`)
  else if (num(p.simulationSpeed || 1) !== 1) warn(`${owner} 的 simulationSpeed 是 ${num(p.simulationSpeed)}，延遲要不要跟著倍速沒有依據，引擎忽略延遲`)
  else if (ancestors(n).some((a) => a.ps && !isZeroCurve(a.ps.startDelay))) warn(`${owner}：祖先的粒子系統也有延遲，子系統要不要跟著等沒有依據，引擎忽略延遲`)
  else return minMax(d)
  return null
}

function particleSystem(n, at) {
  const p = n.ps, r = n.rect, psr = n.psr
  if (isSilent(p)) { note(`${n.name}：emission 關、沒有 burst，不發射粒子，略過`); return null }
  for (const [k, v] of Object.entries(p)) if (v && typeof v === 'object' && v.enabled && k.endsWith('Module') && !SUPPORTED_MODULES.has(k)) warn(`${n.name}：${k} 開著，引擎不支援（會被忽略）`)
  if (psr.m_RenderMode !== 0 && psr.m_RenderMode !== 1) warn(`${n.name}：渲染模式 ${psr.m_RenderMode} 引擎不支援（只有 billboard 0／拉伸 1）`)
  const delay = startDelay(n)
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
    // 不延遲的不輸出（已上站其他台的 JSON 不變）
    ...(delay ? { delay } : {}),
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
    // 每種形狀都有的進階選項，引擎都沒做（10-17 盤點 60 台一個都沒用到）
    if (S.sphericalDirectionAmount) warn(`${n.name}：形狀的 Spherize Direction ${S.sphericalDirectionAmount} 引擎不支援`)
    if (S.randomPositionAmount) warn(`${n.name}：形狀的 Randomize Position ${S.randomPositionAmount} 引擎不支援`)
    if (S.alignToDirection) warn(`${n.name}：形狀的 Align To Direction 引擎不支援`)
    if (S.m_Texture?.pid && S.m_Texture.pid !== '0') warn(`${n.name}：形狀有貼圖（依貼圖染色／剔除），引擎不支援`)
    sys.shape = {
      type: S.type, radius: num(S.radius?.value), thickness: num(S.radiusThickness ?? 1), angle: num(S.angle), length: num(S.length),
      randomDir: num(S.randomDirectionAmount), scale: vec3(S.m_Scale ?? { x: 1, y: 1, z: 1 }), rotation: vec3(S.m_Rotation), position: vec3(S.m_Position),
    }
  }
  const V = p.VelocityModule, F = p.ForceModule, L = p.ClampVelocityModule, N = p.NoiseModule, RM = p.RotationModule, C = p.ColorModule, Z = p.SizeModule, UV = p.UVModule
  if (V?.enabled) {
    sys.velocity = { x: minMax(V.x), y: minMax(V.y), z: minMax(V.z), world: !!V.inWorldSpace }
    // 引擎只做線性的 x／y／z。orbital（繞軸轉）、offset（轉動中心）、radial（徑向）、speedModifier（速度倍率）沒做，10-17 前也沒檢查、
    // 被默默忽略——方塊那 4 台（1052、2040、2043、2053）的灰燼就開了 orbitalZ＝1。orbital 的單位 Unity 文件與 C# reference 都沒寫
    // （rad/s 還是 °/s），沒有官方依據或實測前不實作，見 _local-notes/2026-10/2026-10-17_卡池動態_Box形狀/
    const used = ['orbitalX', 'orbitalY', 'orbitalZ', 'orbitalOffsetX', 'orbitalOffsetY', 'orbitalOffsetZ', 'radial'].filter((k) => !isZeroCurve(V[k]))
    if (used.length) warn(`${n.name}：速度模組的 ${used.join('／')} 引擎不支援（會被忽略）`)
    const sm = V.speedModifier
    if (sm && !((sm.minMaxState === 0 || sm.minMaxState === 3) && num(sm.scalar) === 1 && (sm.minMaxState === 0 || num(sm.minScalar) === 1))) warn(`${n.name}：速度模組的 speedModifier 不是 1，引擎不支援（會被忽略）`)
  }
  if (F?.enabled) sys.force = { x: minMax(F.x), y: minMax(F.y), z: minMax(F.z), world: !!F.inWorldSpace }
  if (L?.enabled) sys.clamp = { magnitude: minMax(L.magnitude), dampen: num(L.dampen) }
  if (N?.enabled) sys.noise = { frequency: num(N.frequency), scroll: minMax(N.scrollSpeed), strength: minMax(N.strength), amount: minMax(N.positionAmount) }
  if (RM?.enabled) sys.rotationOverLife = minMax(RM.curve)
  if (C?.enabled) sys.colorOverLife = minMaxGradient(C.gradient)
  if (Z?.enabled) sys.sizeOverLife = Z.separateAxes ? { x: minMax(Z.curve), y: minMax(Z.y) } : { x: minMax(Z.curve) }
  if (UV?.enabled) { const uv = uvModule(UV, n.name); if (uv) sys.uv = uv }
  return sys
}

// ── 流動圖層（Image／RawImage＋UI_CommonFlow 或 UI/Flow1）──────────────────────────
/**
 * 兩種 shader 共用的版面：{ pos, size, rot?, clip? }（輸出時接在 name 後面，鍵的順序與 10-17 前相同）。
 * 矩形：中心＝pivot 換到正中央再過變換；大小＝矩形×自己的縮放×祖先累積的縮放；旋轉＝變換後 x 軸在畫布上的角度（自己＋祖先）。
 * 1027 銜尾蛇、1301 破曉者-02 的圖層自己就轉了 −128°～+153°，10-17 前沒輸出、被畫成水平的。
 * 自己的負縮放（2055 雪鴞的 Light02、Fire：localScale.x＝−1）＝鏡像：size 本來就帶著 s 的正負號，引擎的四角 UV 會跟著左右／上下對調；
 * 旋轉要先把這個鏡像拿掉再量（不拿掉的話 x 軸朝左會被量成轉 180°，疊上負寬度變成上下翻）。正縮放時乘的是 1，已上站的 rot 逐位元不變。
 * 引擎畫的是平面上轉過的矩形：繞 x／y 軸轉（傾斜、翻面）、祖先的鏡像、非均勻縮放疊旋轉造成的歪斜報 ⚠
 */
function flowGeom(n, at, owner) {
  const s = n.rect.m_LocalScale, Mp = at.parent.M, M = at.M
  const k = [Math.hypot(Mp[0][0], Mp[1][0], Mp[2][0]), Math.hypot(Mp[0][1], Mp[1][1], Mp[2][1])]
  const center = mApply(M, [(0.5 - at.pivot[0]) * at.size[0], (0.5 - at.pivot[1]) * at.size[1], 0]).map((v, i) => v + at.t[i])
  const sx = s.x < 0 ? -1 : 1, sy = s.y < 0 ? -1 : 1
  const rot = Math.atan2(M[1][0] * sx, M[0][0] * sx)
  if (Math.abs(at.q[0]) > 1e-4 || Math.abs(at.q[1]) > 1e-4) warn(`${owner}：圖層（含祖先）繞 x／y 軸轉，引擎只畫平面上的旋轉`)
  if ((M[0][0] * M[1][1] - M[0][1] * M[1][0]) * sx * sy < 0) warn(`${owner}：圖層的祖先有負縮放（鏡像），引擎不翻轉貼圖`)
  else if (Math.abs(M[0][0] * M[0][1] + M[1][0] * M[1][1]) > 1e-3 * Math.hypot(M[0][0], M[1][0]) * Math.hypot(M[0][1], M[1][1])) warn(`${owner}：祖先的非均勻縮放疊上旋轉、圖層會歪斜，引擎畫成矩形`)
  const clip = clipOf(at, n.name)
  return {
    pos: [num(center[0]), num(center[1])],
    size: [num(at.size[0] * s.x * k[0]), num(at.size[1] * s.y * k[1])],
    // 不轉的不輸出（已上站其他台的 JSON 不變）
    ...(Math.abs(rot) > 1e-6 ? { rot: num(rot) } : {}),
    ...(clip ? { clip } : {}),
  }
}

/**
 * Image＋UI_CommonFlow。
 * 溶解貼圖刻意不輸出：10-16 對遊戲畫面校準時，照字面套「噪聲溶解」會整塊閃（每格變化量 7.9 對遊戲 1.5），
 * 關掉溶解才對得上（1.6）。引擎的流動 shader 因此沒有溶解這一段，見 gachaFxEngine.ts。
 */
function flowLayer(n, img, at) {
  const m = D.materials[img.material], f = m.floats, owner = `${n.name}：材質 ${img.material}`
  const c = img.fields.m_Color, mc = m.colors._Color ?? [1, 1, 1, 1]
  const geom = flowGeom(n, at, owner)
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
    ...geom,
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

/**
 * Image／RawImage＋UI/Flow1（1028、1035、2027、2055、2061、3020…）。公式見「UI/Flow1 的規格」；這裡把材質換成 FxFlow1，預設值不輸出。
 * 網格：Image 沒掛 sprite（61 台都是）時 UV 是整張、_MainTex＝材質的；RawImage 有 texture 就用它當 _MainTex（Unity 的 mainTexture，
 * 1035 海拉的 Flash_Mask01 就是）。sprite 會連 UV 一起換掉、匯出檔又沒有 sprite，所以掛了就報 ⚠。
 */
function flow1Layer(n, mb, at) {
  const m = D.materials[mb.material], f = m.floats, c = m.colors, owner = `${n.name}：材質 ${mb.material}（UI/Flow1）`
  const geom = flowGeom(n, at, owner)
  flow1Unsupported(m, owner)
  const F = mb.fields
  if (mb.script === 'Image') {
    if (F.m_Sprite?.pid && F.m_Sprite.pid !== '0') warn(`${owner}：Image 掛了 sprite（會換掉 _MainTex 與 UV），匯出檔沒有 sprite，引擎不支援`)
    if (F.m_Type) warn(`${owner}：Image 的類型 ${F.m_Type}（不是 Simple），引擎只畫整張矩形`)
    if (F.m_PreserveAspect) warn(`${owner}：Image 開了 preserveAspect，引擎不支援`)
  } else {
    const u = F.m_UVRect
    if (u && (u.x || u.y || u.width !== 1 || u.height !== 1)) warn(`${owner}：RawImage 的 uvRect 不是整張（${JSON.stringify(u)}），引擎不支援`)
  }
  const dst = f._Dst ?? 10
  if (dst !== 1 && dst !== 10) warn(`${owner} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  /** 貼圖：省略＝shader 預設 white；wrap 照匯出（兩軸不同時取 U） */
  const tx = (name, what) => {
    if (!name) return undefined
    const w = D.textures[name]?.wrap
    if (!w) warn(`${owner}：匯出檔沒有 ${what} 的 wrap（10-17 前的匯出），請用 export-gacha-prefab.py 重匯`)
    else if (w[0] !== w[1]) warn(`${owner} 的 ${what} 兩軸 wrap 不同，引擎取 U 的`)
    return { tex: useTex(name, `${owner} 的 ${what}`), ...(repeats(name) ? { repeat: true } : {}) }
  }
  const mainTO = (c._MainTex1TO ?? ST_ID).map(num), mainFlow = [num(c._Tex1Flow?.[0]), num(c._Tex1Flow?.[1])]
  const main = tx(m.tex._MainTex1?.tex, '_MainTex1')
  const colName = mb.texture ?? m.tex._MainTex?.tex
  const colST = texST(m.tex._MainTex)
  const disturbValue = num(f._DisturbValue ?? 0)
  const disturbTO = (c._DisturbTO ?? ST_ID).map(num)
  const ic = F.m_Color, mc = c._Color ?? [1, 1, 1, 1]
  const mask = (i) => {
    const t = m.tex[`_Mask${i}`]?.tex, rev = !!f[`_Mask${i}Revert2`]
    if (!t) { if (rev) warn(`${owner} 沒有 _Mask${i} 卻開了反轉遮罩：預設白色反轉後整層透明，遊戲裡看不見`); return undefined }
    return {
      tex: tx(t, `_Mask${i}`), st: texST(m.tex[`_Mask${i}`]),
      ...(i === 1 ? { rotate: deg(f._Mask1Rotate) } : {}),
      softness: num(f[`_Mask${i}Softness`] ?? 0), ...(rev ? { revert: true } : {}),
    }
  }
  const mask1 = mask(1), mask2 = mask(2)
  return {
    shader: 'flow1',
    name: n.name,
    ...geom,
    color: [num(ic.r * mc[0]), num(ic.g * mc[1]), num(ic.b * mc[2]), num(ic.a * mc[3])],
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    mainValue: num(f._MainValue ?? 1),
    ...(main ? { main } : {}),
    ...(f._MainTexRotate ? { mainRotate: deg(f._MainTexRotate) } : {}),
    ...(mainFlow[0] || mainFlow[1] ? { mainFlow } : {}),
    ...(isIdentityST(mainTO) ? {} : { mainTO }),
    ...((f._VRepeatSwitch ?? 1) === 0 ? { vClamp: true } : {}),
    // 主貼圖是 white 時取 R 沒有差別，不輸出
    ...(main && f._ChannelChoose ? { channelR: true } : {}),
    ...(colName
      ? { colorTex: { ...tx(colName, mb.texture ? `${mb.script} 的 texture` : '_MainTex'), ...(isIdentityST(colST) ? {} : { st: colST }), ...(f._ColorRotate ? { rotate: deg(f._ColorRotate) } : {}) } }
      : {}),
    // 擾動量是 0 時 D 用不到（不論有沒有擾動圖）
    ...(disturbValue
      ? {
          disturb: {
            ...(m.tex._DisturbTex?.tex ? { tex: tx(m.tex._DisturbTex.tex, '_DisturbTex') } : {}),
            value: disturbValue,
            flow: [num(c._DisturbFlow?.[0]), num(c._DisturbFlow?.[1])],
            to: disturbTO,
            ...(f._ModeCtrl1 ? { axis: f._ModeCtrl2 ? 'v' : 'u' } : {}),
          },
        }
      : {}),
    ...(dissolveActive(m)
      ? {
          dissolve: {
            ...(m.tex._DissolveTex?.tex ? { tex: tx(m.tex._DissolveTex.tex, '_DissolveTex') } : {}),
            st: texST(m.tex._DissolveTex),
            flow: [num(f._DisFlowU ?? 0), num(f._DisFlowV ?? 0)],
            ...(m.tex._DissolveMask?.tex ? { mask: tx(m.tex._DissolveMask.tex, '_DissolveMask') } : {}),
            maskST: texST(m.tex._DissolveMask),
            value: num(f._DissolveValue ?? 0),
            softness: num(f._DissolveSoftness ?? 0),
            ...(f._DissolveMaskRevert ? { revert: true } : {}),
          },
        }
      : {}),
    ...(mask1 ? { mask1 } : {}),
    ...(mask2 ? { mask2 } : {}),
  }
}

const systems = [], flows = []
/** 輸出的系統／圖層在 nodes 裡的位置（排繪製順序用） */
const sysAt = [], flowAt = []
for (const [i, n] of nodes.entries()) {
  if (!isActive(n)) continue
  if (n.ps) { const s = particleSystem(n, layout[i]); if (s) { systems.push(s); sysAt.push(i) } continue }
  for (const mb of n.mb ?? []) {
    if (!mb.material) continue
    const shader = D.materials[mb.material]?.shader
    if (mb.script === 'Image' && shader === SHADER_FLOW) { flows.push(flowLayer(n, mb, layout[i])); flowAt.push(i) }
    else if ((mb.script === 'Image' || mb.script === 'RawImage') && shader === SHADER_FLOW1) { flows.push(flow1Layer(n, mb, layout[i])); flowAt.push(i) }
    else if (shader) warn(`${n.name}：${mb.script} 用了材質 ${mb.material}（${shader}），引擎不畫`)
  }
}

/**
 * Tween 類元件（TweenAlpha／TweenScale…，遊戲自己的 UITweener 系列）會在執行時改顏色或變換，引擎都沒做。
 * 61 台只有 1035 海拉的 Flash_Mask01、2014 的 BG_Fx 在畫的節點上掛 TweenAlpha（1.5 秒循環的閃爍）；
 * 語意照 NGUI 推得出來，但遊戲是 IL2CPP、沒有原始碼可對，對遊戲畫面確認前不實作——不處理會畫成常亮，所以報 ⚠。
 */
for (const i of [...sysAt, ...flowAt]) {
  for (let x = i; x != null; x = nodes[x].parent) {
    for (const b of nodes[x].mb ?? []) if (/^Tween/.test(b.script) && b.fields?.m_Enabled !== 0) warn(`${nodes[i].name}：${x === i ? '' : `祖先 ${nodes[x].name} 的 `}${b.script} 會在執行時做動畫，引擎不支援`)
  }
}

/**
 * Animator（Unity 動畫片段，2026-10-17 機師 J-3 補）：機師卡池有 14 位在特效容器上掛循環片段（1.3–8 秒，動發光層的顏色／透明度、位移、開關），
 * 機甲 3 台。引擎沒有片段播放器，照畫會是片段之外的靜止狀態——報 ⚠，等 J-4。匯出檔 10-17 前沒有 animator 欄位（舊匯出看不到，要重匯）。
 * 只看開著的、而且在要畫的節點或它的祖先上的（羅斯瑪麗那個是關的）。
 */
const animated = new Set()
for (const i of [...sysAt, ...flowAt]) {
  for (let x = i; x != null; x = nodes[x].parent) if (nodes[x].animator && nodes[x].animator.enabled !== 0) animated.add(x)
}
for (const x of animated) warn(`${nodes[x].name}：Animator（${nodes[x].animator.controller ?? '控制器讀不到'}）會在執行時做動畫，引擎不支援`)

/**
 * 繪製順序（10-17 J-1 補）：Unity UI 照階層前序畫，UIParticle 在它的節點位置畫底下的粒子、Image 在自己的位置畫。
 * 引擎是「粒子全部畫完再畫流動圖層」；階層在所有 UIParticle 之前的圖層輸出 under，引擎先畫它（1028、2055、2061、3020 的 Flow1 圖層，
 * 其中 2061、3020 與 2055 的 Fire 是透明混色，畫在粒子後面會把粒子蓋住）。已上站各台的 UI_CommonFlow 圖層全在粒子之後，不受影響。
 * 夾在兩組粒子之間的圖層引擎排不出來，報 ⚠（61 台只有 1051 的 Image02）。
 */
const uiParticleOf = (i) => { for (let x = i; x != null; x = nodes[x].parent) if ((nodes[x].mb ?? []).some((b) => b.script === 'UIParticle')) return x; return i }
if (systems.length) {
  const at = sysAt.map(uiParticleOf), lo = Math.min(...at), hi = Math.max(...at)
  flows.forEach((fl, j) => {
    if (flowAt[j] < lo) fl.under = true
    else if (flowAt[j] < hi) warn(`${fl.name}：圖層在階層裡夾在兩組粒子（UIParticle）之間，引擎只能畫在全部粒子之前或之後`)
  })
}

const out = { v: 1, prefab: D.prefab, canvas: CANVAS, unit: 100, systems, flows }
const json = JSON.stringify(out)

// ── 輸出 ──────────────────────────────────────────────────────────────────
const dataOut = join(ROOT, isPilot ? 'src/data/gachaFx/pilots' : 'src/data/gachaFx', `${wap}.json`)
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
console.log(`✅ 寫入 src/data/gachaFx/${isPilot ? 'pilots/' : ''}${wap}.json，貼圖 ${usedTex.size - missing.length} 張 → public/images/game/fx/`)
