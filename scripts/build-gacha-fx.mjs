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
 * 10-29 起標日期的功能（orbital、拖尾、Animator 片段、Tween、插畫切片、反組譯的 UI_General／UI/Common／UIShiny／SpeedLine… 等）是 EN wiki 作者 HuyT
 * 拿 10-28 給他的芬里厄範例包擴充的，10-30 換回本 repo（用陸版重建，機甲 64、機師 63 與他的成品逐位元相同；機師只差艾達有 ⚠）。
 * 10-31 補 Image＋UI_General（generalLayer，含 _SoftDissValue 曲線）：陸版艾達的兩道掃光（他用國際版，沒有這兩張），機甲 64、機師 63 全部 0 ⚠。
 * 各功能的英文說明與他的批次管線在 _local-notes/2026-10/2026-10-30_EN作者_HuyT原始說明/，評估在同月的 2026-10-30_EN作者_卡池動態補完評估.md。
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
/** Unity 的 Quaternion.Euler（度）：先繞 z、再繞 x、最後繞 y（q＝qy·qx·qz） */
const qEuler = ([x, y, z]) => {
  const h = Math.PI / 360
  return qMul(qMul([0, Math.sin(y * h), 0, Math.cos(y * h)], [Math.sin(x * h), 0, 0, Math.cos(x * h)]), [0, 0, Math.sin(z * h), Math.cos(z * h)])
}

/**
 * RectMask2D：遊戲裡 UIParticle 與 Image 都是 MaskableGraphic，會被祖先的 RectMask2D 裁成矩形（同一個節點上的不算，照 Unity 的
 * MaskUtilities；巢狀的取交集；矩形取四角的外接框，Unity 也是這樣）。10-17 盤點 60 台有 28 台的粒子在 RectMask2D 底下，
 * 多半就是根節點那麼大（2500×1080）：只有切進根節點矩形（＝遊戲畫面）的那幾邊才裁，輸出 clip、引擎用 scissor
 * （例：2052 裁決者的 Particle_Wind 只在左半邊的遮罩裡）。站上的插畫是 2600 寬，左右各多露出 50 px 遊戲看不到的部分，
 * 那裡照沒有遮罩的台處理、不裁——照字面裁在 ±1250 會在插畫上切出一條直線（2071、3005 就是這種）。
 * softness（邊緣羽化）與 padding 60 台都沒用到：softness 報 ⚠、padding 照算。
 */
const ROOT_LE = (nodes[0].mb ?? []).find((m) => m.script === 'LayoutElement')?.fields
/** rectOf(i)：節點 i 的 RectTransform（Animator 片段取樣時換成那一刻的值，見 animation） */
function buildLayout(rectOf) {
  const layout = []
  for (const [i, n] of nodes.entries()) {
    const r = rectOf(i)
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
  return layout
}

// ── Animator 片段（10-29 起，3027 巨像的探照燈：無人機飄、光束掃、CanvasGroup 呼吸）────────────────────
/**
 * 匯出檔的 animator.clips（export-gacha-prefab.py 的 decode_clip）在這裡取樣。支援的屬性：Transform 的歐拉角（三軸都有）、縮放，
 * RectTransform 的 anchoredPosition、sizeDelta，CanvasGroup 的 alpha；其他（顏色、開關、位置…）報 ⚠ 照靜止畫。
 * 每個圖層受影響的（自己或祖先被動到）由 builder 照 ANIM_FPS（有上色的軌時更密，見 fps）烘成逐格的四角＋alpha（anim），引擎線性內插；
 * 片段的曲線 10-29 量過最快每 0.1 秒 1.3°，每秒 10 格內插誤差看不出來。粒子系統被動到報 ⚠（引擎不支援）。
 * 靜止的欄位（pos／size／rot／color）用片段第 0 秒的樣子：遊戲一開就播片段，prefab 存的姿勢不會出現在畫面上。
 * 只看開著的、而且底下（含自己）有要畫的東西的 Animator（2026-10-17 J-3 起的規則；羅斯瑪麗那個是關的）。
 * 機師卡池有 14 位、機甲 3 台掛片段；10-17 前的匯出沒有 animator 欄位，10-29 前的沒有 clips（要重匯）。
 * 10-29 機師起另外支援兩種「上色」的軌（不算變換，不讓圖層多出 quad 軌、也不算動到粒子）：
 *   Image／RawImage 的 m_Color.a（只管自己那一層，不像 CanvasGroup 往下傳），烘進 anim.alpha；
 *   遊戲的 UIShaderVariableProxy（m_float_N／m_vector_N／m_tilingOffset_N，值寫進同一個 Image 的材質，屬性名在 m_*_names[N]，
 *   沒被動到的分量用元件存的值）：引擎能逐格換的屬性見 PROP_TRACKS，其他報 ⚠。
 * 同日起 UIShiny 的 m_EffectFactor（掃光位置）也算上色的軌，烘進 anim.shiny（見 shinyLayer）；m_Rotation 等其他欄位照舊報 ⚠。
 * 10-29 起路徑對不到節點的曲線（匯出檔留 path CRC）改記 note 不報 ⚠：Unity 綁不到的路徑直接略過，遊戲裡也不動。
 * 當時 4 位機師有：艾達 10103118 的 Tag、愛黛兒 10103159 的 GlassesLight（節點已改名 Tag02／GlassesLight01…），
 * 凱瑟琳 10103109、10103153 的對不到任何節點路徑（換名字變體也沒有）。
 * 10-29 起 GameObject 的 m_IsActive（typeID 1）在粒子系統上也支援：不算變換也不算上色，見 activeOf。
 * 凱瑟琳的 KnifeLightParticle（0.8 秒起開、1.53 秒一輪）、艾達的 Particle_Star02（prefab 裡是關的，片段開兩段）。
 * 關掉 Animator 自己（或祖先）的：Unity 裡 Animator 跟著停，關掉就不會自己再打開（10103140 哈德威的 Con_Effect）；10-29 起照使用者決定記 note、忽略。
 */
/** 節點 i 自己或子孫有粒子系統、掛材質的 Image／RawImage 或插畫切片 */
const drawsBelow = (i) => nodes.some((n, j) => (n.ps || (n.mb ?? []).some((m) => m.material || m.texture || m.sprite)) && j >= i && ancestors(n).concat(n).includes(nodes[i]))
const ANIM_FPS = 10
// m_LocalPosition.z（10-29 補，10103119 希兒薇的 Root_Butterfly）：RectTransform 的 z 在 m_LocalPosition（見 buildLayout），
// 正交投影下只在祖先有 x／y 軸旋轉時才影響畫面，一起算進去
const ANIM_RECT = { 'm_AnchoredPosition.x': ['m_AnchoredPosition', 'x'], 'm_AnchoredPosition.y': ['m_AnchoredPosition', 'y'], 'm_SizeDelta.x': ['m_SizeDelta', 'x'], 'm_SizeDelta.y': ['m_SizeDelta', 'y'], 'm_LocalPosition.z': ['m_LocalPosition', 'z'] }
/** 一條曲線在 t 的值：t 之前最後一段的三次式 */
function curveAt(keys, t) {
  let k = keys[0]
  for (const x of keys) if (x[0] <= t + 1e-9) k = x
  const dt = Math.max(0, t - k[0])
  return ((k[1] * dt + k[2]) * dt + k[3]) * dt + k[4]
}
const PROXY_FIELD = /^m_(float|vector|tilingOffset)_(\d)(?:\.([xyzw]))?$/
/** 節點上開著的 UIShiny（見 shinyLayer） */
const shinyOf = (n) => (n.mb ?? []).find((b) => b.script === 'UIShiny' && b.fields?.m_Enabled !== 0)
/** 節點上的 Image／RawImage */
const graphicOf = (n) => (n.mb ?? []).find((b) => b.script === 'Image' || b.script === 'RawImage')
/** 片段動到的 UIShaderVariableProxy 欄位 → { name（材質屬性名）, field（float／vector／tilingOffset）, comp?, base（元件存的值） }；對不到 null */
function proxyProp(i, prop) {
  const m = PROXY_FIELD.exec(prop), px = (nodes[i].mb ?? []).find((b) => b.script === 'UIShaderVariableProxy')
  if (!m || !px || !graphicOf(nodes[i])) return null
  const [, field, k, comp] = m, F = px.fields ?? {}, name = F[`m_${field}_names`]?.[+k]
  if (!name || (field === 'float') === !!comp) return null
  return { name, field, ...(comp ? { comp } : {}), base: F[`m_${field}_${k}`] ?? (comp ? { x: 0, y: 0, z: 0, w: 0 } : 0) }
}
const animation = (() => {
  const tracks = [] // { node, kind: 'euler'|'scale'|'rect'|'alpha'|'graphicA'|'prop'|'shiny'|'shinyRot', comp, keys }（prop 另有 name、field）
  /** 換 sprite 的軌（10-29 補，10103171 戰部渡的 Img_Sequence）：節點 → { keys, pre, names（片段的 pptr 表）, len } */
  const sprites = new Map()
  let len = 0
  for (const [i, n] of nodes.entries()) {
    const A = n.animator
    if (!A || A.enabled === 0 || !isActive(n) || !drawsBelow(i)) continue
    if (!A.clips?.length) { warn(`${n.name}：Animator（${A.controller ?? '控制器讀不到'}）會在執行時做動畫，匯出檔沒有片段（10-29 前的匯出，要重匯）`); continue }
    if (A.clips.length > 1) warn(`${n.name}：Animator 有 ${A.clips.length} 個片段，只取第一個（${A.clips[0].name}）`)
    const clip = A.clips[0]
    if (!clip.loop) warn(`${n.name}：片段 ${clip.name} 不循環，引擎照循環播`)
    len = Math.max(len, clip.stop - clip.start)
    const euler = new Map(), lost = new Map()
    for (const cv of clip.curves) {
      const at = cv.node, who = nodes[at]?.name
      const [nm, comp] = String(cv.prop).split('.')
      if (at == null) (lost.get(cv.path) ?? lost.set(cv.path, []).get(cv.path)).push(cv.prop)
      else if (at != null && cv.type === 4 && (nm === 'euler' || nm === 'scale')) {
        if (nm === 'euler') (euler.get(at) ?? euler.set(at, new Set()).get(at)).add(comp)
        tracks.push({ node: at, kind: nm, comp, keys: cv.keys })
      } else if (at != null && cv.type === 224 && ANIM_RECT[cv.prop]) tracks.push({ node: at, kind: 'rect', comp: cv.prop, keys: cv.keys })
      else if (at != null && cv.type === 225 && cv.prop === 'm_Alpha') tracks.push({ node: at, kind: 'alpha', keys: cv.keys })
      else if (at != null && cv.type === 114 && cv.prop === 'm_Color.a' && graphicOf(nodes[at])) tracks.push({ node: at, kind: 'graphicA', keys: cv.keys })
      else if (at != null && cv.type === 114 && cv.prop === 'm_EffectFactor' && shinyOf(nodes[at])) tracks.push({ node: at, kind: 'shiny', keys: cv.keys })
      else if (at != null && cv.type === 114 && cv.prop === 'm_Rotation' && shinyOf(nodes[at])) tracks.push({ node: at, kind: 'shinyRot', keys: cv.keys })
      else if (at != null && cv.type === 114 && cv.prop === 'm_FillAmount' && graphicOf(nodes[at])?.script === 'Image') tracks.push({ node: at, kind: 'fill', keys: cv.keys })
      else if (at != null && cv.type === 114 && cv.prop === 'm_Sprite' && clip.pptr && graphicOf(nodes[at])?.script === 'Image')
        sprites.set(at, { keys: cv.keys, pre: cv.pre ?? 0, names: clip.pptr, len: clip.stop - clip.start })
      else if (at != null && cv.type === 114 && proxyProp(at, cv.prop)) tracks.push({ node: at, kind: 'prop', ...proxyProp(at, cv.prop), keys: cv.keys })
      else if (at != null && cv.type === 1 && cv.prop === 'm_IsActive' && !ancestors(n).concat(n).includes(nodes[at])) tracks.push({ node: at, kind: 'active', len: clip.stop - clip.start, keys: cv.keys })
      // 關掉 Animator 自己（或祖先）的 m_IsActive（10103140 哈德威的 Con_Effect：2.33 秒關、片段 4.03 秒）：Unity 裡 Animator 跟著停、
      // 不會再打開，但片段到 4 秒都有接得起來的關鍵格。2026-10-29 使用者決定照整段循環、不管這條軌（未對遊戲畫面）
      else if (at != null && cv.type === 1 && cv.prop === 'm_IsActive') note(`${n.name}：片段 ${clip.name} 把 ${who}（Animator 自己或祖先）關掉，照使用者決定忽略，整段循環`)
      else warn(`${n.name}：片段 ${clip.name} 動到 ${who} 的 ${cv.prop}（typeID ${cv.type}），引擎不支援，照靜止畫`)
    }
    for (const [crc, props] of lost) note(`${n.name}：片段 ${clip.name} 動到路徑 CRC ${crc}（${props.join('、')}），prefab 裡沒有這個節點，遊戲裡也不動，略過`)
    for (const [at, cs] of euler) if (cs.size < 3) warn(`${nodes[at].name}：片段只動歐拉角的 ${[...cs].join('')} 軸，引擎要三軸都有`)
  }
  if (!tracks.length && !sprites.size) return null
  const shade = (x) => x.kind === 'graphicA' || x.kind === 'prop' || x.kind === 'shiny' || x.kind === 'shinyRot' || x.kind === 'fill'
  const moved = new Set(tracks.filter((x) => !shade(x) && x.kind !== 'active').map((x) => x.node))
  const shaded = new Set(tracks.filter(shade).map((x) => x.node))
  // 每秒幾格：上色的軌照它們最密的兩個關鍵格取（10103174 海莉絲的擾動量每 0.03～0.1 秒正負翻一次，每秒 10 格會抹平），最多 30；
  // 只有變換／CanvasGroup 的片段（機甲）照舊 ANIM_FPS
  let gap = Infinity
  for (const x of tracks.filter(shade)) for (let k = 1; k < x.keys.length; k++) gap = Math.min(gap, x.keys[k][0] - x.keys[k - 1][0])
  const fps = Math.max(ANIM_FPS, Math.min(30, Math.ceil(1 / gap - 1e-6)))
  /** 節點 i 或它的祖先被片段動到（變換或 CanvasGroup） */
  const touches = (i) => { for (let x = i; x != null; x = nodes[x].parent) if (moved.has(x)) return true; return false }
  /**
   * t 時的 RectTransform、CanvasGroup alpha，與上色的軌：graphicA（節點 → Image 顏色的 a）、
   * props（節點 → { 材質屬性名 → { field, v } }，v 是數字或 {x,y,z,w}）、shiny（節點 → UIShiny 的 m_EffectFactor）
   */
  function at(t) {
    const rects = new Map(), alpha = new Map(), graphicA = new Map(), props = new Map(), shiny = new Map(), shinyRot = new Map(), fill = new Map()
    const rect = (i) => rects.get(i) ?? rects.set(i, { ...nodes[i].rect }).get(i)
    const eul = new Map()
    for (const x of tracks) {
      if (x.kind === 'active') continue
      const v = curveAt(x.keys, t)
      if (x.kind === 'alpha') alpha.set(x.node, v)
      else if (x.kind === 'graphicA') graphicA.set(x.node, v)
      else if (x.kind === 'shiny') shiny.set(x.node, v)
      else if (x.kind === 'shinyRot') shinyRot.set(x.node, v)
      else if (x.kind === 'fill') fill.set(x.node, v)
      else if (x.kind === 'prop') {
        const P = props.get(x.node) ?? props.set(x.node, {}).get(x.node)
        const p = P[x.name] ?? (P[x.name] = { field: x.field, v: typeof x.base === 'object' ? { ...x.base } : x.base })
        if (x.comp) p.v[x.comp] = v
        else p.v = v
      }
      else if (x.kind === 'euler') (eul.get(x.node) ?? eul.set(x.node, {}).get(x.node))[x.comp] = v
      else if (x.kind === 'scale') { const r = rect(x.node); r.m_LocalScale = { ...r.m_LocalScale, [x.comp]: v } }
      else { const [key, c] = ANIM_RECT[x.comp], r = rect(x.node); r[key] = { ...r[key], [c]: v } }
    }
    for (const [i, e] of eul) {
      if (e.x == null || e.y == null || e.z == null) continue
      const q = qEuler([e.x, e.y, e.z])
      rect(i).m_LocalRotation = { x: q[0], y: q[1], z: q[2], w: q[3] }
    }
    return { layout: buildLayout((i) => rects.get(i) ?? nodes[i].rect), alpha, graphicA, props, shiny, shinyRot, fill }
  }
  /**
   * 節點 i 自己或祖先被片段開關（m_IsActive）：{ len, on: [[起, 迄)…] }（全部的軌都開著的區間；曲線是階梯，值 > 0.5＝開）。
   * 沒被開關 undefined；不同長度的片段疊在一起 'mixed'
   */
  function activeOf(i) {
    const own = tracks.filter((x) => x.kind === 'active' && (x.node === i || ancestors(nodes[i]).includes(nodes[x.node])))
    if (!own.length) return undefined
    const L = own[0].len
    if (own.some((x) => Math.abs(x.len - L) > 1e-6)) return 'mixed'
    const cuts = [...new Set([0, ...own.flatMap((x) => x.keys.map((k) => k[0])).filter((t) => t > 0 && t < L)])].sort((a, b) => a - b)
    const on = []
    cuts.forEach((t, k) => {
      if (!own.every((x) => curveAt(x.keys, t) > 0.5)) return
      const end = cuts[k + 1] ?? L
      if (on.length && on[on.length - 1][1] === t) on[on.length - 1][1] = end
      else on.push([t, end])
    })
    return { len: num(L), on: on.map(([a, b]) => [num(a), num(b)]) }
  }
  /** 節點 x 自己有 m_IsActive 軌 */
  const switched = (x) => tracks.some((t) => t.kind === 'active' && t.node === x)
  return { len, fps, touches, shaded: (i) => shaded.has(i), at, activeOf, switched, spriteOf: (i) => sprites.get(i) }
})()
const anim0 = animation?.at(0)
const layout = anim0?.layout ?? buildLayout((i) => nodes[i].rect)
/**
 * 上色的軌在片段的某一格 f 套到節點 i 的 Image／RawImage（mb）上：顏色的 a、UIShaderVariableProxy 寫進的材質屬性。
 * 回傳換過的元件與材質（都是複本：材質是好幾個節點共用的）；材質 undefined＝照 mb.material
 */
function shadeAt(i, mb, f) {
  const a = f?.graphicA.get(i), P = f?.props.get(i)
  const img = a == null ? mb : { ...mb, fields: { ...mb.fields, m_Color: { ...mb.fields.m_Color, a } } }
  let m = P && mb.material ? D.materials[mb.material] : undefined
  if (m) {
    m = { ...m, floats: { ...m.floats }, colors: { ...m.colors }, tex: { ...m.tex } }
    for (const [name, { field, v }] of Object.entries(P)) {
      if (field === 'float') m.floats[name] = v
      else if (field === 'vector') m.colors[name] = [v.x, v.y, v.z, v.w]
      else { const t = name.replace(/_ST$/, ''); if (m.tex[t]) m.tex[t] = { ...m.tex[t], scale: [v.x, v.y], offset: [v.z, v.w] } }
    }
  }
  return { img, m }
}
/**
 * 引擎能逐格換的材質屬性（10-29 起）：圖層種類 → UIShaderVariableProxy 寫的屬性名 → [anim 的軌名, 從材質取這一格的值, 圖層有那一段才有作用]。
 * 10103174 海莉絲的風車葉（UI_CommonFlow 的擾動量）、10103179 鄭樂萱的眼鏡反光（UI_CommonFlow 遮罩位移）、
 * 10103136／10103141 艾麗莎等的掃光（UI/Flow1 遮罩 1 的 tiling／offset）
 */
const PROP_TRACKS = {
  flow: {
    _DisturbValue: ['disturbValue', (m) => [num(m.floats._DisturbValue ?? 0)], () => true],
    _MaskTex1TO: ['maskTO', (m) => (m.colors._MaskTex1TO ?? ST_ID).map(num), (fl) => !!fl.mask],
  },
  flow1: {
    _Mask1_ST: ['mask1ST', (m) => texST(m.tex._Mask1), (fl) => !!fl.mask1],
    // 10-29 補，10103118 艾達的 SweepLight01／02（溶解貼圖一直有，片段把值從 1 降到 0：掃光從溶解中浮現）
    _DissolveValue: ['dissolveValue', (m) => [num(m.floats._DissolveValue ?? 0)], (fl) => !!fl.dissolve],
  },
  // 10-31 補，10103118 艾達的 SweepLightGroup/1、2（軟溶解開著才讀 _SoftDissValue，見 generalParams）
  general: {
    _SoftDissValue: ['softValue', (m) => [num(m.floats._SoftDissValue ?? 0)], (fl) => fl.general.soft?.value != null],
  },
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
const SHADER_GENERAL = 'UI_General'
const SHADER_UI_COMMON = 'UI/Common'
/**
 * Unity 內建的 Mobile/Particles/Additive（10-29 補，3047 的 FireParticle06；shader 打包在 ui_uifx_uifxcommon_abs.b）：
 * 反組譯是 tex(_MainTex, uv×_MainTex_ST) × 頂點色，Blend SrcAlpha One，屬性只有 _MainTex——等於粒子 shader 的強度 1、疊加。
 * 材質上的 _TintColor（2,2,2,1）、_Intensity、_DistTex_* 是換 shader 前的殘值，這支 shader 不讀
 */
const SHADER_MOBILE_ADD = 'Mobile/Particles/Additive'
const SHADER_EFFECT_STD = 'effect/C_EffectStandard'
const SHADER_SPEEDLINE = 'ProjectFM/UI/SpeedLine'
/** UI/Default 的疊加版（10-29 補，shaders/UIAdditive/）：(貼圖＋_TextureSampleAdd)×頂點色，Blend SrcAlpha One */
const SHADER_UIADD = 'ProjectFM/UI/UIAdditive'
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
// 引擎照公式全做，只有粒子 Custom Data（_ModeCtrl，全是 0）沒做。第二張主貼圖 _MainTex2（_Tex2Intensity，41 個材質全是 0）10-29 補上
// （10103106 娜歐蜜的 M_UIFX_PilotGacha_Naomi_2＝−1，見 flow1Params 的 main2；反組譯留在 shaders/Flow1/）。
const isWhite = (c) => !c || c.every((x) => x === 1)
/** Flow1 材質裡引擎沒做、或做了也會畫錯的設定：圖層與粒子兩條路徑共用 */
function flow1Unsupported(m, owner) {
  const f = m.floats
  if (f._ModeCtrl) warn(`${owner} 的 _ModeCtrl＝${f._ModeCtrl}（粒子 Custom Data 控制位移／擾動／溶解），引擎不支援`)
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
/**
 * effect/C_EffectStandard 當粒子材質（10-29 補，10103175 尼爾的 Light09）。反組譯在 shaders/C_EffectStandard/：沒有關鍵字，
 * 每段都一直開著，沒指定的貼圖用 shader 的預設（_DistortTex black、溶解／遮罩／第二層的貼圖 white）：
 *   主貼圖：tex(_MainTex，UV 繞中心轉 _DiffuseAng×0.0174、再加 _Time.y×(_Uspeed, _Vspeed)、再乘 _MainTex_ST，另加擾動 _DistortTex.r×a×_Force)
 *     × 頂點色 × _Color × _Brightness（四個通道都乘），alpha 再乘 _DiffuseMaskTex.a；
 *   第二層：加上 _SecondLayerTex × _SecondLayerMaskTex.a × 頂點色 × _SecondLayerColor × _SecondLayerBrightness；
 *   溶解：x＝_DissolveSize－(_DissolveTex.r－_Dissolve)，_DissolveTex.r－_Dissolve < 0 的捨棄，x < 0 時不變色。
 * 混色 Blend [_SrcRGBMode] [_DestRGBMode]。只做「單張主貼圖」的情況：擾動貼圖沒指定（或 _Force 0）、遮罩沒指定、第二層亮度 0、
 * 溶解貼圖沒指定且 x < 0、不捲動、_MainTex_ST 是單位、SrcAlpha＋One／OneMinusSrcAlpha；其他報 ⚠。
 * 這樣畫面＝貼圖 × _Color × 頂點色 × _Brightness，同 UI/Flow1 的單張貼圖（strengthAlpha、tint）；旋轉方向跟 uRot 相反，換號
 */
function effectStdParticleMaterial(m, name, owner) {
  const f = m.floats, c = m.colors, T = m.tex, own = `${owner}：材質 ${name}（${SHADER_EFFECT_STD}）`
  const gaps = []
  if (T._DistortTex?.tex && (f._ForceX || f._ForceY)) gaps.push('擾動 _DistortTex')
  if (T._DiffuseMaskTex?.tex) gaps.push('遮罩 _DiffuseMaskTex')
  if (f._SecondLayerBrightness ?? 1) gaps.push('第二層 _SecondLayerTex')
  if (T._DissolveTex?.tex || (f._DissolveSize ?? 0.15) - 1 + (f._Dissolve ?? 0) >= 0) gaps.push('溶解')
  if (f._Uspeed || f._Vspeed) gaps.push('主貼圖捲動 _Uspeed／_Vspeed')
  if (!isIdentityST(texST(T._MainTex))) gaps.push('主貼圖 tiling／位移')
  // 轉過的角落超出 0–1 最多 (|sin|＋1－cos)／2：不到一個像素（尼爾的 0.33°、256 px 是 0.75 px）就跟夾邊一樣
  const rotate = (f._DiffuseAng ?? 0) * 0.0174, tx = D.textures[T._MainTex?.tex]
  const over = ((Math.abs(Math.sin(rotate)) + 1 - Math.cos(rotate)) / 2) * Math.max(tx?.w ?? 0, tx?.h ?? 0)
  if (rotate && tx && repeats(T._MainTex.tex) && over >= 1) gaps.push('旋轉後角落的貼圖重複（wrap＝Repeat）')
  const src = f._SrcRGBMode ?? 5, dst = f._DestRGBMode ?? 10
  if (src !== 5 || (dst !== 1 && dst !== 10)) gaps.push(`混色 ${src}／${dst}（只做 SrcAlpha＋One／OneMinusSrcAlpha）`)
  if (gaps.length) warn(`${own} 用到 ${gaps.join('、')}，引擎不支援，照單張主貼圖畫`)
  const tint = (c._Color ?? [1, 1, 1, 1]).map(num)
  return {
    tex: useTex(T._MainTex?.tex, `${own} 的主貼圖`),
    strength: num(f._Brightness ?? 1),
    texRotate: rotate ? num(-rotate) : 0,
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    strengthAlpha: true,
    ...(isWhite(tint) ? {} : { tint }),
  }
}

function flow1ParticleMaterial(m, name, owner, dst) {
  const f = m.floats, c = m.colors, own = `${owner}：材質 ${name}（UI/Flow1）`
  flow1Unsupported(m, own)
  const main = m.tex._MainTex1?.tex, col = m.tex._MainTex?.tex
  const gaps = []
  if (main && col) gaps.push('主貼圖與顏色貼圖兩張')
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
  if (f._Tex2Intensity) gaps.push('第二張主貼圖 _MainTex2')
  const tint = (c._Color ?? [1, 1, 1, 1]).map(num)
  // 用到單張貼圖以外的設定（10-29 補，2018、2049、2062、3007、3047）：輸出整組 Flow1 參數，引擎改用 Flow1 shader 畫；
  // 顏色＝粒子顏色 × tint（_Color），跟圖層的 Image 顏色 × _Color 一樣。只用單張貼圖的照舊（已上站的 JSON 不變）
  if (gaps.length) {
    return {
      tex: main ?? col ?? '',
      strength: num(f._MainValue ?? 1),
      texRotate: 0,
      ...(dst === 10 ? { blend: 'alpha' } : {}),
      strengthAlpha: true,
      ...(isWhite(tint) ? {} : { tint }),
      flow1: flow1Params(m, own, col, '_MainTex'),
    }
  }
  return {
    tex: useTex(tex, `${own} 的主貼圖（_MainTex1 與 _MainTex 都沒指定）`),
    strength: num(f._MainValue ?? 1),
    texRotate: rotate ? -deg(rotate) : 0,
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    strengthAlpha: true,
    ...(isWhite(tint) ? {} : { tint }),
  }
}

/**
 * UI_General 當粒子材質（10-29 補；3010 的 liuguang_01、3047 的 StoneParticle02）。公式反組譯自 shader_abs.b 的 D3D11 片段程式，
 * 常數槽位用 parsed form 的綁定對上屬性名（GLSL 在 gachaFxEngine.ts 的 FS_GENERAL）。只讀 shader 自己的 41 個屬性：
 * 換過 shader 的材質會留著舊 shader 的值（Wind04 有整組 UI_CommonFlow 的 _DisturbValue／_Tex1Flow，Flower02 有 UIFx_Alpha 的
 * _Color_Str／_Dst3），那些 shader 根本不讀。選填的段落只在會改變結果時輸出。Blend SrcAlpha [_Dst]，_Dst 預設 0（＝Zero）
 */
function generalParticleMaterial(m, name, owner) {
  const { g, dst, tint } = generalParams(m, `${owner}：材質 ${name}（UI_General）`)
  return {
    tex: g.main?.tex ?? '',
    strength: 1,
    texRotate: 0,
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    ...(isWhite(tint) ? {} : { tint }),
    general: g,
  }
}

/** UI_General 的參數（粒子與 Image 共用，10-31 從 generalParticleMaterial 拆出來）→ { g＝FxGeneralParams, dst, tint＝_Color } */
function generalParams(m, own) {
  const f = m.floats, c = m.colors, t = m.tex
  const dst = f._Dst ?? 0
  if (dst !== 1 && dst !== 10) warn(`${own} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  if (f._UseUIAlphaClip) warn(`${own} 開了 UNITY_UI_ALPHACLIP（alpha 小於 0.001 丟掉），引擎沒做`)
  if ((f._ColorMask ?? 15) !== 15) warn(`${own} 的 _ColorMask＝${f._ColorMask}，引擎不支援`)
  if ((f._StencilComp ?? 8) !== 8 || f._StencilOp) warn(`${own} 用了模板測試，引擎不支援`)
  const tx = (te, what) => {
    if (!te?.tex) return undefined
    const w = D.textures[te.tex]?.wrap
    if (w && w[0] !== w[1]) warn(`${own} 的 ${what} 兩軸 wrap 不同，引擎取 U 的`)
    return { tex: useTex(te.tex, `${own} 的 ${what}`), ...(repeats(te.tex) ? { repeat: true } : {}) }
  }
  const v2 = (x) => [num(x?.[0]), num(x?.[1])]
  const nz2 = (x) => x[0] || x[1]
  /** 一段選填貼圖：tex／st／speed，預設值不輸出 */
  const layer = (te, what, speed) => {
    const tex = tx(te, what), st = texST(te), sp = v2(speed)
    return { ...(tex ? { tex } : {}), ...(isIdentityST(st) ? {} : { st }), ...(nz2(sp) ? { speed: sp } : {}) }
  }
  const tint = (c._Color ?? [1, 1, 1, 1]).map(num), mainColor = (c._MainColor ?? [1, 1, 1, 1]).map(num)
  const mainST = texST(t._MainTex), mainSpeed = v2(c._MainSpeed), colorRB = v2(c._MainColorRB)
  const g = {
    ...(t._MainTex?.tex ? { main: tx(t._MainTex, '_MainTex') } : {}),
    ...(isIdentityST(mainST) ? {} : { mainST }),
    ...(nz2(mainSpeed) ? { mainSpeed } : {}),
    ...(f._MainRotation ? { mainRotate: deg(f._MainRotation) } : {}),
    ...(nz2(colorRB) ? { colorRB } : {}),
    ...(isWhite(mainColor) ? {} : { mainColor }),
    centre: num(f._Centre ?? 1),
  }
  const noiseValue = num(f._NoiseValue ?? 0)
  if (noiseValue || f._ToggleSwitch3) g.noise = { ...layer(t._NoiseTex, '_NoiseTex', c._NoiseSpeed), value: noiseValue, ...(f._ToggleSwitch3 ? { uOnly: true } : {}) }
  if (f._ToggleSwitch2) {
    g.edge = {
      ...layer(t._EdgeDissTex, '_EdgeDissTex', c._EageDissSpeed),
      value: num(f._EdgeDissValue ?? 0), width: num(f._EdgeWidth ?? 0), color: (c._EageColor ?? [1, 1, 1, 1]).map(num),
      ...(f._ToggleSwitch6 ? { revert: true } : {}),
    }
  }
  for (const [key, i, sw] of [['mask1', '01', '_ToggleSwitch0'], ['mask2', '02', '_ToggleSwitch7']]) {
    const te = t[`_MaskTex${i}`]
    if (!te?.tex && !f[sw]) continue
    if (!te?.tex) warn(`${own} 沒有 _MaskTex${i} 卻開了反轉：預設白色反轉後整個透明，遊戲裡看不見`)
    g[key] = { ...layer(te, `_MaskTex${i}`, c[`_MaskSpeed${i}`]), ...(f[`_MaskRotation${i}`] ? { rotate: deg(f[`_MaskRotation${i}`]) } : {}), ...(f[sw] ? { revert: true } : {}) }
  }
  // 軟溶解：沒有貼圖時是常數，照 shader 算出來是 1 就等於沒有
  const F4 = f._Float4 ?? 0.51, softOn = !!f._ToggleSwitch1, softV = f._SoftDissValue ?? 0, softRev = !!f._ToggleSwitch5
  const sd = (softRev ? 0 : 1) + 1 + (softOn ? -2 * softV : 2) - (1 - F4), x = Math.min(1, Math.max(0, sd / (2 * F4 - 1)))
  if (t._SoftDissTex?.tex || x * x * (3 - 2 * x) !== 1) {
    g.soft = { ...layer(t._SoftDissTex, '_SoftDissTex', c._SoftDissSpeed), ...(softOn ? { value: num(softV) } : {}), float4: num(F4), ...(softRev ? { revert: true } : {}) }
  }
  return { g, dst, tint }
}

/**
 * Image＋UI_General（10-31 補，10103118 艾達的 SweepLightGroup/1、2：陸版的青色掃光，片段經 UIShaderVariableProxy 把 _SoftDissValue
 * 在 0.3～0.78 來回推）。shader 只讀 UV 與頂點色，Image 沒掛 sprite 時 UV 是 0～1、頂點色是 Image 顏色，所以跟粒子同一套參數（同 uiCommonLayer）；
 * 材質 _Color（粒子的 tint）乘進頂點色
 */
function generalLayer(n, img, at, m = D.materials[img.material]) {
  const owner = `${n.name}：材質 ${img.material}（UI_General）`
  if (img.fields.m_Sprite?.pid && img.fields.m_Sprite.pid !== '0') warn(`${owner}：Image 掛了 sprite，引擎當成整張（UV 0～1）`)
  if (img.fields.m_Type) warn(`${owner}：Image 類型 ${img.fields.m_Type}（不是 Simple），引擎畫成整張矩形`)
  const { g, dst, tint } = generalParams(m, owner), c = img.fields.m_Color
  return {
    name: n.name,
    ...flowGeom(n, at, owner),
    shader: 'general',
    color: [c.r, c.g, c.b, c.a].map((v, k) => num(v * tint[k])),
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    general: g,
  }
}

/**
 * UI/Common 當粒子材質（10-29 補；肖妮 10102102 的 Particle_Smoke_3、娜塔莉亞 10103105 的 Particle_Glow2／3）。公式反組譯自 shader_abs.b
 * 的 D3D11 片段程式（shaders/UI_Common/），三個 [Toggle] 關鍵字照材質上的開關值（_MainTex_Disstong、_Alpha_Tex_Disstong1、_LiziAlpha）。
 * 常數槽位：parsed form 只列所有變體共用的屬性，扭曲那幾個（cb0[5].x、[6]、[7]）照屬性說明對：[6]＝_Distortions_Tex_ST、
 * [7].xy＝_Distortion_U／V（捲動）、[5].x＝_Float2（「U_扭曲強度占比率」）、[7].z＝_Float4（V）、[7].w＝_DistortionIndensity（兩軸都乘）。
 * 貼圖預設全是 white，沒指定的段落恰好恆等就不輸出。Blend [_Scr] [_Dst]，預設 5／1（SrcAlpha／One）。
 * 換過 shader 的材質留著別的 shader 的值（_Color、_Color_Str、_Dst3…），這支 shader 不讀
 */
function uiCommonParticleMaterial(m, name, owner) {
  const { g, dst } = uiCommonParams(m, `${owner}：材質 ${name}（UI/Common）`)
  return {
    tex: g.main?.tex ?? '',
    strength: 1,
    texRotate: 0,
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    uiCommon: g,
  }
}
/** UI/Common 材質的參數（粒子與 10-29 起的 Image 圖層共用）：{ g（FxUICommonParams）, dst } */
function uiCommonParams(m, own) {
  const f = m.floats, c = m.colors, t = m.tex
  const src = f._Scr ?? 5, dst = f._Dst ?? 1
  if (src !== 5) warn(`${own} 的混色來源 _Scr＝${src}，引擎只支援 5（SrcAlpha）`)
  if (dst !== 1 && dst !== 10) warn(`${own} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  const tx = (te, what) => {
    if (!te?.tex) return undefined
    const w = D.textures[te.tex]?.wrap
    if (w && w[0] !== w[1]) warn(`${own} 的 ${what} 兩軸 wrap 不同，引擎取 U 的`)
    return { tex: useTex(te.tex, `${own} 的 ${what}`), ...(repeats(te.tex) ? { repeat: true } : {}) }
  }
  const v2 = (a, b) => [num(a ?? 0), num(b ?? 0)]
  const nz2 = (x) => x[0] || x[1]
  /** 一段選填貼圖：沒貼圖＝white，整段恆等，不輸出 */
  const layer = (te, what, speed) => {
    const tex = tx(te, what)
    if (!tex) return undefined
    const st = texST(te)
    return { tex, ...(isIdentityST(st) ? {} : { st }), ...(nz2(speed) ? { speed } : {}) }
  }
  const mainST = texST(t._MainTex), mainSpeed = v2(f._Disslve_U1, f._Disslve_V1)
  const power = num(f._MainPower ?? 1), intensity = num(f._Main_Intensity ?? 1), all = num(f._All_Alpha ?? 1)
  const mainColor = (c._MainColor ?? [1, 1, 1, 1]).map(num), alphaSel = (c._Alpha_Main ?? [0, 0, 0, 1]).map(num)
  const g = {
    ...(t._MainTex?.tex ? { main: tx(t._MainTex, '_MainTex') } : {}),
    ...(isIdentityST(mainST) ? {} : { mainST }),
    ...(nz2(mainSpeed) ? { mainSpeed } : {}),
    ...(power !== 1 ? { power } : {}),
    ...(intensity !== 1 ? { intensity } : {}),
    ...(isWhite(mainColor.slice(0, 3)) ? {} : { mainColor: mainColor.slice(0, 3) }),
    ...(alphaSel.every((x, i) => x === [0, 0, 0, 1][i]) ? {} : { alphaSel }),
    ...(all !== 1 ? { allAlpha: all } : {}),
    ...(f._LiziAlpha ? { particleAlpha: true } : {}),
  }
  // 扭曲：開關沒開或兩軸強度都是 0 就恆等（主貼圖 +0、alpha 貼圖 ×(1+0)）
  const onMain = !!f._MainTex_Disstong, onAlpha = !!f._Alpha_Tex_Disstong1
  const I = num(f._DistortionIndensity ?? 0.5), ku = num((f._Float2 ?? 1) * I), kv = num((f._Float4 ?? 1) * I)
  if ((onMain || onAlpha) && (ku || kv)) {
    g.distort = {
      ...(layer(t._Distortions_Tex, '_Distortions_Tex', v2(f._Distortion_U, f._Distortion_V)) ?? {}),
      k: [ku, kv], ...(onMain ? { main: true } : {}), ...(onAlpha ? { alpha: true } : {}),
    }
  }
  const alpha = layer(t._AlphaTex, '_AlphaTex', v2(f._AlphaU, f._AlphaV))
  const alpha3 = layer(t._AlphaTex3, '_AlphaTex3', v2(f._Alpha3U, f._Alpha3V))
  const grad = layer(t._Grad2, '_Grad2', v2(f._Color_U, f._Color_V))
  if (alpha) g.alpha = alpha
  if (alpha3) g.alpha3 = alpha3
  if (grad) g.grad = grad
  return { g, dst }
}

/**
 * Image＋UI/Common（10-29 補，10103106 娜歐蜜的 Fx_Noise_1／2：整片螢幕雜訊，_Dst 10）。shader 只讀 UV 與頂點色（反組譯 shaders/UI_Common/），
 * Image 沒掛 sprite 時 UV 是 0～1、頂點色是 Image 顏色，所以跟粒子同一套參數；_LiziAlpha 開著＝乘 Image 顏色的 a
 */
function uiCommonLayer(n, img, at, m = D.materials[img.material]) {
  const owner = `${n.name}：材質 ${img.material}（UI/Common）`
  if (img.fields.m_Sprite?.pid && img.fields.m_Sprite.pid !== '0') warn(`${owner}：Image 掛了 sprite，引擎當成整張（UV 0～1）`)
  if (img.fields.m_Type) warn(`${owner}：Image 類型 ${img.fields.m_Type}（不是 Simple），引擎畫成整張矩形`)
  const { g, dst } = uiCommonParams(m, owner), c = img.fields.m_Color
  return {
    name: n.name,
    ...flowGeom(n, at, owner),
    shader: 'uiCommon',
    color: [num(c.r), num(c.g), num(c.b), num(c.a)],
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    ...g,
  }
}

/**
 * 粒子材質：UIFx_Alpha 直接用。UI_CommonFlow 當粒子材質時，只用到主貼圖、亮度與旋轉的照試作的做法（芬里厄的日蝕光環，沿用粒子 shader、
 * 已上站的 JSON 不變）；用到遮罩、捲動、tiling、擾動的（10-29 補，1038、1070、2057、3034、3301、3302…）輸出 flow，引擎改用流動 shader 畫
 */
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
  if (m.shader === SHADER_GENERAL) return generalParticleMaterial(m, name, owner)
  if (m.shader === SHADER_UI_COMMON) return uiCommonParticleMaterial(m, name, owner)
  if (m.shader === SHADER_EFFECT_STD) return effectStdParticleMaterial(m, name, owner)
  // BlackJackShader/Unlit（10-29 補）：新建粒子系統的預設材質 BJUnlit，各台拿來當裝特效的父節點（FU、Particle_All、Center…），
  // 約 50 池都把 emission 關了；10103183 希拉的 Center 還開著（最多 1 顆）。shader 是不透明的 _MainTex（預設 white）× _Color、
  // 不吃頂點色（shaders/BJ_Unlit/），照字面會一直有一塊 50% 灰的方塊。當成看不到的容器、略過（2026-10-29 使用者決定，未對遊戲畫面）
  if (m.shader === 'BlackJackShader/Unlit') { note(`${owner}：材質 ${name}（BlackJackShader/Unlit）是新建粒子系統的預設材質，當成裝特效的容器、不畫`); return null }
  if (m.shader === SHADER_MOBILE_ADD) {
    if (!isIdentityST(texST(m.tex._MainTex))) warn(`${owner}：材質 ${name}（${SHADER_MOBILE_ADD}）的 _MainTex 有 tiling／位移，引擎忽略`)
    return { tex: useTex(m.tex._MainTex?.tex, `${owner}：材質 ${name} 的 _MainTex`), strength: 1, texRotate: 0 }
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
  let flow = null
  if (isFlow) {
    const own = `${owner}：材質 ${name}`
    const full = !!m.tex._Mask1?.tex || !!(m.colors._Tex1Flow?.[0] || m.colors._Tex1Flow?.[1]) || !!m.floats._DisturbValue ||
      !isIdentityST(texST(m.tex._MainTex)) || !isIdentityST((m.colors._MainTex1TO ?? ST_ID).map(num))
    if (full) flow = commonFlowParams(m, own)
    else flowUnsupported(m, own)
  }
  const tex = (m.tex._Tex ?? m.tex._MainTex)?.tex
  return {
    tex: useTex(tex, `${owner}：材質 ${name} 的主貼圖`),
    strength: num(isFlow ? (m.floats._MainValue ?? 1) : (m.floats._Color_Str ?? 1)),
    texRotate: num(isFlow ? ((m.floats._MainTexRotate || 0) * Math.PI) / 180 : 0),
    // 疊加是預設、不輸出（既有的 JSON 不變）
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    ...(flow ? { flow } : {}),
  }
}

// ── 序列幀（UVModule＝Texture Sheet Animation）────────────────────────────────
/**
 * 只支援 Grid 模式、依壽命／依速度（10-29 補，10103154 蘿莎的 Particle_Glow_2）／依 fps；其餘情況報 ⚠、不輸出（引擎照舊畫整張貼圖）。
 * 10-17 盤點 60 台開著的 102 個：全是 Grid、依壽命 101／依 fps 1、單列的 19 個全是隨機列、沒有翻轉。
 * frameOverTime／startFrame 是 Unity 存的正規化值（0–1，×格數＝幀號；Inspector 顯示的是 ×格數之後），原樣輸出。
 */
function uvModule(U, owner) {
  if (U.mode !== 0) { warn(`${owner}：序列幀是 Sprites 模式（mode ${U.mode}），引擎只支援 Grid`); return null }
  if (U.timeMode !== 0 && U.timeMode !== 1 && U.timeMode !== 2) { warn(`${owner}：序列幀的時間模式 ${U.timeMode} 引擎不支援`); return null }
  if (U.animationType === 1 && U.rowMode !== 0 && U.rowMode !== 1) warn(`${owner}：序列幀單列的列模式 ${U.rowMode}（依網格索引）引擎不支援，當成第 ${U.rowIndex ?? 0} 列`)
  if (U.flipU || U.flipV) warn(`${owner}：序列幀有翻轉（flipU ${U.flipU}／flipV ${U.flipV}），引擎忽略`)
  if (U.startFrame?.minMaxState === 1 || U.startFrame?.minMaxState === 2) warn(`${owner}：序列幀的 startFrame 是曲線，引擎取曲線起點`)
  const single = U.animationType === 1
  return {
    tilesX: Math.max(1, U.tilesX), tilesY: Math.max(1, U.tilesY), animationType: single ? 1 : 0,
    ...(single ? { rowMode: U.rowMode === 1 ? 1 : 0, rowIndex: U.rowIndex ?? 0 } : {}),
    timeMode: U.timeMode,
    ...(U.timeMode === 0 ? { frameOverTime: minMax(U.frameOverTime), cycles: num(U.cycles ?? 1) }
      : U.timeMode === 1 ? { frameOverTime: minMax(U.frameOverTime), speedRange: [num(U.speedRange?.x ?? 0), num(U.speedRange?.y ?? 1)] }
      : { fps: num(U.fps) }),
    startFrame: minMax(U.startFrame),
  }
}

// ── 粒子系統 ──────────────────────────────────────────────────────────────
/** 引擎實作了的模組；其他模組開著就提醒（UVModule 支援一部分，細項在 uvModule() 裡檢查） */
const SUPPORTED_MODULES = new Set(['InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'RotationModule', 'ColorModule', 'VelocityModule', 'ForceModule', 'ClampVelocityModule', 'NoiseModule', 'UVModule', 'RotationBySpeedModule', 'SizeBySpeedModule', 'TrailModule'])

/**
 * 拖尾（TrailModule，10-29 補；1018、3011 的 Particle_Shoot_1 曳光彈）：只做 PerParticle 模式（Ribbon 模式報 ⚠）。材質是 renderer 的第二個槽，
 * 只支援粒子 shader 那一種（UI_CommonFlow／Flow1／UI_General／UI/Common 當拖尾材質報 ⚠）。光照、陰影、子發射器相關的欄位跟 UI 無關，不輸出
 */
function trailModule(T, psr, name) {
  if (T.mode !== 0) warn(`${name}：拖尾的 Ribbon 模式（mode ${T.mode}）引擎不支援，當成 PerParticle`)
  const material = particleMaterial(psr.materials?.[1], `${name} 的拖尾`)
  if (!material) { warn(`${name}：拖尾沒有材質（renderer 第二個槽），引擎不畫拖尾`); return null }
  if (material.flow || material.flow1 || material.general || material.uiCommon) warn(`${name}：拖尾材質用了流動／UI_General／UI/Common shader，引擎只畫單張貼圖`)
  return {
    ratio: num(T.ratio ?? 1),
    lifetime: minMax(T.lifetime),
    minVertexDistance: num(T.minVertexDistance),
    textureMode: T.textureMode ?? 0,
    dieWithParticles: !!T.dieWithParticles,
    sizeAffectsWidth: !!T.sizeAffectsWidth,
    sizeAffectsLifetime: !!T.sizeAffectsLifetime,
    inheritParticleColor: !!T.inheritParticleColor,
    colorOverLifetime: minMaxGradient(T.colorOverLifetime),
    widthOverTrail: minMax(T.widthOverTrail),
    colorOverTrail: minMaxGradient(T.colorOverTrail),
    material,
  }
}
/**
 * 0 球、4 圓錐、5 方塊、8 圓錐體積、10 圓形（10-29 起，2014 金剛狼的 Particle_Light）。
 * 圓形：形狀 xy 平面上半徑 radius 的圓盤（radiusThickness＝從外緣往內多厚，1＝整個圓盤），方向是從圓心往外（Unity 手冊）。
 * arc：Random 模式（mode 0）、spread 0 的照做（10-29 起）——角度在 0～arc 之間均勻亂數，從形狀的 +x 往 +y 量（Unity 的圓形 gizmo）；
 * 不是 360° 才輸出 shape.arc（已上站的 JSON 不變）。其他模式（Loop／Ping-Pong／Burst Spread）或 spread 報 ⚠。
 * 圓錐（4、8）也有 arc，引擎照 360° 畫、不報：2018 的圓錐 arc 60° 已經上站，要改得另外對過畫面。
 * 方塊（10-17 J-1 補）：Unity 編輯器的「Emit from」不是另一個欄位，而是 type 本身——5＝Volume（Box）、15＝Shell（BoxShell）、
 * 16＝Edge（BoxEdge），boxThickness 只在 Shell／Edge 才有作用（UnityCsReference 的 ParticleSystemEnums.cs、ShapeModuleUI.cs）。
 * 所以 type 5 不必多輸出欄位：方塊大小就是形狀的 scale（以原點為中心），沿用既有的 scale／rotation／position。
 * Shell／Edge 是 15／16，不在這裡、照舊報 ⚠（10-17 盤點 60 台的 22 個方塊全是 5，boxThickness 全是 0）。
 */
const SUPPORTED_SHAPES = new Set([0, 4, 5, 8, 10])

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

/**
 * UIParticle 只畫 m_Particles 清單裡的系統（Coffee UIParticle v4 序列化的清單；清單空的才在 OnEnable 自己抓子孫，所以空清單不過濾），
 * 並把清單裡系統的 ParticleSystemRenderer 關掉——所以已上站各台的 renderer 幾乎都是 m_Enabled:false。
 * 不在清單裡、renderer 又關著的：誰都不畫，略過（10-29 起，3011 狄亞斯的容器 Particle_All：emission 開著每秒 10 顆，
 * 材質是沒貼圖的 BlackJackShader/Unlit，清單 20 個不含它）。
 * 不在清單裡、renderer 開著的（2014 的 Particle_Star_1–3、3006 的 Smoke／Smoke01／Trail1／Glow3，兩台都恰好是清單外的才開著）：
 * 遊戲裡由 Unity 一般的 3D 粒子管線畫，大小（沒有 UIParticle 的 ×100）與前後順序可能和 UI 不同，看得到多少要對遊戲畫面；
 * 照舊當 UI 粒子畫、只記一行 ·，JSON 不變。
 * 看最近的 UIParticle 祖先（含自己）；匯出檔沒有 psId（10-29 前的匯出）就不過濾。
 */
function unlisted(i) {
  for (let x = i; x != null; x = nodes[x].parent) {
    const u = (nodes[x].mb ?? []).find((b) => b.script === 'UIParticle')
    if (!u) continue
    const list = u.fields?.m_Particles ?? []
    return !!nodes[i].psId && list.length > 0 && !list.some((p) => p.pid === nodes[i].psId)
  }
  return false
}

/**
 * billboard 四邊形的 pivot 與 Render Alignment（10-29 補，Audrey 10103165 的劍光 LineGlow01）：
 *   pivot：以粒子大小為單位、在粒子自己的座標（跟著粒子旋轉）裡把四邊形移開（Unity 的 m_Pivot；z 在正交投影下看不出來，不管）。
 *   align：Render Alignment＝Local（2）時四邊形躺在系統的區域 xy 平面上，跟著系統（累積祖先）的旋轉轉、再正交投影到畫布：
 *     輸出旋轉矩陣左上 2×2 [a, b, c, d]（畫布 x＝a·x＋b·y、y＝c·x＋d·y）。View（0）／World（1）在 UI 相機下都正對畫面，照舊。
 * 都只在用到時才輸出（沒有 pivot、不是 Local 或旋轉是單位的，已上站的 JSON 不變）；拉伸模式的 pivot 報 ⚠。
 */
function billboardShape(psr, at, name) {
  const out = {}
  const pv = psr.m_Pivot ?? { x: 0, y: 0 }
  if (num(pv.x) !== 0 || num(pv.y) !== 0) {
    if (psr.m_RenderMode === 0) out.pivot = [num(pv.x), num(pv.y)]
    else warn(`${name}：渲染模式 ${psr.m_RenderMode} 的 pivot（${pv.x}, ${pv.y}）引擎不支援`)
  }
  if (psr.m_RenderAlignment === 2 && psr.m_RenderMode === 0) {
    const R = qMat(at.q), a = [num(R[0][0]), num(R[0][1]), num(R[1][0]), num(R[1][1])]
    if (a[0] !== 1 || a[1] !== 0 || a[2] !== 0 || a[3] !== 1) out.align = a
  } else if (psr.m_RenderAlignment !== 0 && psr.m_RenderAlignment !== 1 && psr.m_RenderMode === 0) {
    warn(`${name}：Render Alignment ${psr.m_RenderAlignment} 引擎不支援（只有 View 0／World 1／Local 2）`)
  }
  return out
}

function particleSystem(n, at) {
  const p = n.ps, r = n.rect, psr = n.psr
  if (isSilent(p)) { note(`${n.name}：emission 關、沒有 burst，不發射粒子，略過`); return null }
  for (const [k, v] of Object.entries(p)) if (v && typeof v === 'object' && v.enabled && k.endsWith('Module') && !SUPPORTED_MODULES.has(k)) warn(`${n.name}：${k} 開著，引擎不支援（會被忽略）`)
  // 渲染模式 5＝None：粒子本身不畫，只有拖尾（曳光彈）
  const trail = p.TrailModule?.enabled ? trailModule(p.TrailModule, psr, n.name) : null
  const noSelf = psr.m_RenderMode === 5 && trail
  if (psr.m_RenderMode !== 0 && psr.m_RenderMode !== 1 && !noSelf) warn(`${n.name}：渲染模式 ${psr.m_RenderMode} 引擎不支援（只有 billboard 0／拉伸 1／只畫拖尾的 None 5）`)
  const delay = startDelay(n)
  const I = p.InitialModule, E = p.EmissionModule, S = p.ShapeModule
  // 只畫拖尾時第一個材質槽用不到（不讀它，免得報它的 ⚠），沿用拖尾的
  const material = noSelf ? trail.material : particleMaterial(psr.materials?.[0], n.name)
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
    render: { mode: psr.m_RenderMode, lengthScale: num(psr.m_LengthScale), velocityScale: num(psr.m_VelocityScale), maxSize: num(psr.m_MaxParticleSize), ...billboardShape(psr, at, n.name) },
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
    if (S.type === 10 && (S.arc?.mode || num(S.arc?.spread))) warn(`${n.name}：圓形的 arc ${S.arc?.value}°（模式 ${S.arc?.mode}、spread ${num(S.arc?.spread)}），引擎只做 Random 模式、spread 0`)
    // 每種形狀都有的進階選項，引擎都沒做（10-17 盤點 60 台一個都沒用到）
    if (S.sphericalDirectionAmount) warn(`${n.name}：形狀的 Spherize Direction ${S.sphericalDirectionAmount} 引擎不支援`)
    if (S.randomPositionAmount) warn(`${n.name}：形狀的 Randomize Position ${S.randomPositionAmount} 引擎不支援`)
    if (S.alignToDirection) warn(`${n.name}：形狀的 Align To Direction 引擎不支援`)
    if (S.m_Texture?.pid && S.m_Texture.pid !== '0') warn(`${n.name}：形狀有貼圖（依貼圖染色／剔除），引擎不支援`)
    sys.shape = {
      type: S.type, radius: num(S.radius?.value), thickness: num(S.radiusThickness ?? 1), angle: num(S.angle), length: num(S.length),
      randomDir: num(S.randomDirectionAmount), scale: vec3(S.m_Scale ?? { x: 1, y: 1, z: 1 }), rotation: vec3(S.m_Rotation), position: vec3(S.m_Position),
    }
    if (S.type === 10 && num(S.arc?.value ?? 360) !== 360) sys.shape.arc = num(S.arc.value)
  }
  const V = p.VelocityModule, F = p.ForceModule, L = p.ClampVelocityModule, N = p.NoiseModule, RM = p.RotationModule, C = p.ColorModule, Z = p.SizeModule, UV = p.UVModule
  if (V?.enabled) {
    sys.velocity = { x: minMax(V.x), y: minMax(V.y), z: minMax(V.z), world: !!V.inWorldSpace }
    // orbital（繞軸轉）、offset（轉動中心）、radial（徑向）10-29 補上，都是 0 就不輸出（已上站的 JSON 不變）。
    // orbital 的單位 Unity 文件與 C# reference 都沒寫，10-29 用 3028 天角獸對遊戲畫面確認是 rad/s（見 gachaFxSim.ts 的 ORBITAL_RAD）。
    // 舊註記說 2053 的灰燼開了 orbitalZ＝1，10-29 用目前的陸版匯出查過：2053 沒有任何系統開 orbital
    const xyz = (p) => ({ x: minMax(V[p + 'X']), y: minMax(V[p + 'Y']), z: minMax(V[p + 'Z']) })
    const isUsed = (p) => ['X', 'Y', 'Z'].some((a) => !isZeroCurve(V[p + a]))
    if (isUsed('orbital')) sys.velocity.orbital = xyz('orbital')
    if (isUsed('orbitalOffset')) sys.velocity.offset = xyz('orbitalOffset')
    if (!isZeroCurve(V.radial)) sys.velocity.radial = minMax(V.radial)
    // speedModifier（速度倍率，10-29 補；1036、2018 的 ×10～×15）：恆為 1 就不輸出，見 gachaFxSim.ts
    const sm = V.speedModifier
    if (sm && !((sm.minMaxState === 0 || sm.minMaxState === 3) && num(sm.scalar) === 1 && (sm.minMaxState === 0 || num(sm.minScalar) === 1))) sys.velocity.speedModifier = minMax(sm)
  }
  if (F?.enabled) sys.force = { x: minMax(F.x), y: minMax(F.y), z: minMax(F.z), world: !!F.inWorldSpace }
  if (L?.enabled) sys.clamp = { magnitude: minMax(L.magnitude), dampen: num(L.dampen) }
  if (N?.enabled) sys.noise = { frequency: num(N.frequency), scroll: minMax(N.scrollSpeed), strength: minMax(N.strength), amount: minMax(N.positionAmount) }
  if (RM?.enabled) sys.rotationOverLife = minMax(RM.curve)
  // 依速度旋轉（10-29 補，3047 的 FireParticle01／03）：curve 是 z（平面上的轉速，弧度／秒，同 rotationOverLife）；
  // 速度照 range 對到 0–1 再取曲線。x／y（繞立體軸轉）引擎畫不出來
  const RS = p.RotationBySpeedModule
  if (RS?.enabled) {
    if (RS.separateAxes && (!isZeroCurve(RS.x) || !isZeroCurve(RS.y))) warn(`${n.name}：依速度旋轉的 x／y 軸引擎不支援（只轉 z）`)
    sys.rotationBySpeed = { curve: minMax(RS.curve), range: [num(RS.range?.x), num(RS.range?.y ?? 1)] }
  }
  if (C?.enabled) sys.colorOverLife = minMaxGradient(C.gradient)
  if (Z?.enabled) sys.sizeOverLife = Z.separateAxes ? { x: minMax(Z.curve), y: minMax(Z.y) } : { x: minMax(Z.curve) }
  // 依速度縮放（10-29 補，10103118 艾達、10103154 蘿莎的 Particle_Glow_5）：速率照 range 對到 0–1 取曲線，乘在依壽命縮放之外
  const ZS = p.SizeBySpeedModule
  if (ZS?.enabled) {
    if (ZS.separateAxes && !isZeroCurve(ZS.z)) note(`${n.name}：依速度縮放的 z 軸對平面粒子沒有作用，略過`)
    sys.sizeBySpeed = { x: minMax(ZS.curve), ...(ZS.separateAxes ? { y: minMax(ZS.y) } : {}), range: [num(ZS.range?.x ?? 0), num(ZS.range?.y ?? 1)] }
  }
  if (UV?.enabled) { const uv = uvModule(UV, n.name); if (uv) sys.uv = uv }
  if (trail) sys.trail = trail
  return sys
}

// ── 流動圖層（Image／RawImage＋UI_CommonFlow 或 UI/Flow1）──────────────────────────
/**
 * 兩種 shader 共用的版面：{ pos, size, rot?, clip? }（輸出時接在 name 後面，鍵的順序與 10-17 前相同）。
 * 矩形：中心＝pivot 換到正中央再過變換；大小＝矩形×自己的縮放×祖先累積的縮放；旋轉＝變換後 x 軸在畫布上的角度（自己＋祖先）。
 * 1027 銜尾蛇、1301 破曉者-02 的圖層自己就轉了 −128°～+153°，10-17 前沒輸出、被畫成水平的。
 * 自己的負縮放（2055 雪鴞的 Light02、Fire：localScale.x＝−1）＝鏡像：size 本來就帶著 s 的正負號，引擎的四角 UV 會跟著左右／上下對調；
 * 旋轉要先把這個鏡像拿掉再量（不拿掉的話 x 軸朝左會被量成轉 180°，疊上負寬度變成上下翻）。正縮放時乘的是 1，已上站的 rot 逐位元不變。
 * 繞 x／y 軸轉（傾斜、翻面）、祖先的鏡像、非均勻縮放疊旋轉造成的歪斜（10-29 前報 ⚠，3027 巨像的探照燈）：另外輸出 quad＝四角，
 * 引擎照四角畫平行四邊形。投影是正交的（拿掉 z）：遊戲的 UI 相機如果是透視的，傾斜的層會再有一點近大遠小，這裡沒做。
 * pos／size／rot 照舊輸出（查證用），沒有這些情況的層不輸出 quad，JSON 不變。
 */
/**
 * 矩形在畫布上的三個角：左下、右下、左上（UV (0,0)(1,0)(0,1)），拿掉 z 的正交投影。矩形經仿射變換是平行四邊形，
 * 右上角＝右下＋左上−左下，引擎自己補。round：取到幾位（動畫軌取 0.1 px，檔案小一半以上）
 */
function layerQuad(at, round = num) {
  const x0 = -at.pivot[0] * at.size[0], y0 = -at.pivot[1] * at.size[1], x1 = x0 + at.size[0], y1 = y0 + at.size[1]
  return [[x0, y0], [x1, y0], [x0, y1]].flatMap(([x, y]) => {
    const p = mApply(at.M, [x, y, 0])
    return [round(p[0] + at.t[0]), round(p[1] + at.t[1])]
  })
}
const px10 = (v) => Math.round(v * 10) / 10
function flowGeom(n, at, owner, withClip = true) {
  const s = n.rect.m_LocalScale, Mp = at.parent.M, M = at.M
  const k = [Math.hypot(Mp[0][0], Mp[1][0], Mp[2][0]), Math.hypot(Mp[0][1], Mp[1][1], Mp[2][1])]
  const center = mApply(M, [(0.5 - at.pivot[0]) * at.size[0], (0.5 - at.pivot[1]) * at.size[1], 0]).map((v, i) => v + at.t[i])
  const sx = s.x < 0 ? -1 : 1, sy = s.y < 0 ? -1 : 1
  const rot = Math.atan2(M[1][0] * sx, M[0][0] * sx)
  const quad = Math.abs(at.q[0]) > 1e-4 || Math.abs(at.q[1]) > 1e-4 ||
    (M[0][0] * M[1][1] - M[0][1] * M[1][0]) * sx * sy < 0 ||
    Math.abs(M[0][0] * M[0][1] + M[1][0] * M[1][1]) > 1e-3 * Math.hypot(M[0][0], M[1][0]) * Math.hypot(M[0][1], M[1][1])
  const clip = withClip ? clipOf(at, n.name) : null
  return {
    pos: [num(center[0]), num(center[1])],
    size: [num(at.size[0] * s.x * k[0]), num(at.size[1] * s.y * k[1])],
    // 不轉的不輸出（已上站其他台的 JSON 不變）
    ...(Math.abs(rot) > 1e-6 ? { rot: num(rot) } : {}),
    ...(quad ? { quad: layerQuad(at) } : {}),
    ...(clip ? { clip } : {}),
  }
}

/**
 * Image＋UI_CommonFlow。
 * 溶解貼圖刻意不輸出：10-16 對遊戲畫面校準時，照字面套「噪聲溶解」會整塊閃（每格變化量 7.9 對遊戲 1.5），
 * 關掉溶解才對得上（1.6）。引擎的流動 shader 因此沒有溶解這一段，見 gachaFxEngine.ts。
 */
function flowLayer(n, img, at, m = D.materials[img.material]) {
  const f = m.floats, owner = `${n.name}：材質 ${img.material}`
  const c = img.fields.m_Color, mc = m.colors._Color ?? [1, 1, 1, 1]
  const geom = flowGeom(n, at, owner)
  // 10-17 盤點 60 台的 UI_CommonFlow 圖層 _Dst 全是 1（疊加）；沒存時 shader 預設是 10＝透明。
  // 10-29 起 10＝一般透明也畫（瑪蒂妮的 RainDropMap、奧菲莉亞的 Left／Right、哈德威的 Prograss），輸出 blend，疊加的 JSON 不變
  const dst = f._Dst ?? 10
  if (dst !== 1 && dst !== 10) warn(`${owner} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  return {
    name: n.name,
    ...geom,
    color: [num(c.r * mc[0]), num(c.g * mc[1]), num(c.b * mc[2]), num(c.a * mc[3])],
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    ...commonFlowParams(m, owner),
  }
}

/**
 * UI_CommonFlow 材質的參數（流動圖層與粒子共用，鍵的順序就是 10-17 起流動圖層 JSON 的順序）。
 * 粒子（10-29 補）：遊戲裡粒子的 UV 是 0–1（或序列幀那一格），shader 公式和圖層一樣，所以引擎拿同一支流動 shader 畫，見 particleMaterial
 */
function commonFlowParams(m, owner) {
  const f = m.floats
  for (const k of ['_MainTex1TO', '_dIsturbTexTO', '_DisturbFlow']) if (!m.colors[k]) warn(`${owner} 缺 ${k}`)
  flowUnsupported(m, owner)
  const disturbValue = num(f._DisturbValue ?? 0)
  // 擾動推哪一軸（10-29 反組譯）：_ModeCtrl1＝0 兩軸都推（引擎照校準只推 U）、(1, 0) 只推 U、(1, 1) 只推 V（佐伊的 WavingGlow02／03）。
  // 只推 V 的輸出 disturbV，引擎把同樣的偏移改加在 V 上（遮罩的擾動也一樣）
  const disturbV = !!disturbValue && f._ModeCtrl1 === 1 && f._ModeCtrl2 === 1
  const mainTex = useTex(m.tex._MainTex?.tex, `${owner} 的 _MainTex`)
  // _DisturbTex 沒指定（1027、1040、1301、3027）：shader 預設 black，引擎綁 1×1 黑貼圖——擾動不是 0，是 _DisturbValue 決定的常數偏移
  const disturbTex = m.tex._DisturbTex?.tex
  // _DisturbTex 的 tiling／offset（10-29 補：反組譯是 uv×_DisturbTex_ST 再轉 _MainTexRotate、捲動、_dIsturbTexTO，跟主貼圖同一套）。
  // 只在有擾動時輸出：_DisturbValue＝0 時擾動圖不影響畫面，其他台 JSON 不變。奧菲莉亞、瑪蒂妮、智者的 D1、艾黛兒的 GlassesLight02
  const disturbST = texST(m.tex._DisturbTex)
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
    ...(disturbValue && !isIdentityST(disturbST) ? { disturbST } : {}),
    ...(disturbV ? { disturbV: true } : {}),
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
function flow1Layer(n, mb, at, m = D.materials[mb.material]) {
  const f = m.floats, c = m.colors, owner = `${n.name}：材質 ${mb.material}（UI/Flow1）`
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
  const ic = F.m_Color, mc = c._Color ?? [1, 1, 1, 1]
  return {
    shader: 'flow1',
    name: n.name,
    ...geom,
    color: [num(ic.r * mc[0]), num(ic.g * mc[1]), num(ic.b * mc[2]), num(ic.a * mc[3])],
    ...(dst === 10 ? { blend: 'alpha' } : {}),
    ...flow1Params(m, owner, mb.texture ?? m.tex._MainTex?.tex, mb.texture ? `${mb.script} 的 texture` : '_MainTex'),
  }
}

/**
 * UI/Flow1 材質的參數（圖層與粒子共用，鍵的順序就是 10-17 起 Flow1 圖層 JSON 從 mainValue 開始的順序）。
 * colName：顏色貼圖（_MainTex；圖層的 RawImage 有 texture 時是它）。粒子（10-29 補）：UV 是 0–1（或序列幀那一格），公式和圖層一樣
 */
function flow1Params(m, owner, colName, colWhat) {
  const f = m.floats, c = m.colors
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
  const colST = texST(m.tex._MainTex)
  const disturbValue = num(f._DisturbValue ?? 0)
  const disturbTO = (c._DisturbTO ?? ST_ID).map(num)
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
  // 第二張主貼圖（10-29 補）：強度 0 不輸出（已上站的 JSON 不變）。shader 的 ST 槽（cb2[1]，parsed form 沒列名字）照順序是 _MainTex2_ST
  const tex2I = num(f._Tex2Intensity ?? 0), tex2 = m.tex._MainTex2
  const tex2Flow = [num(c._Tex2Flow?.[0]), num(c._Tex2Flow?.[1])], tex2TO = (c._MainTex2TO ?? ST_ID).map(num), tex2ST = texST(tex2)
  const main2 = tex2I ? {
    ...(tex2?.tex ? { tex: tx(tex2.tex, '_MainTex2') } : {}),
    intensity: tex2I,
    ...(num(f._Tex2Pow ?? 1) !== 1 ? { pow: num(f._Tex2Pow) } : {}),
    ...(tex2Flow[0] || tex2Flow[1] ? { flow: tex2Flow } : {}),
    ...(isIdentityST(tex2TO) ? {} : { to: tex2TO }),
    ...(isIdentityST(tex2ST) ? {} : { st: tex2ST }),
  } : undefined
  return {
    mainValue: num(f._MainValue ?? 1),
    ...(main ? { main } : {}),
    ...(f._MainTexRotate ? { mainRotate: deg(f._MainTexRotate) } : {}),
    ...(mainFlow[0] || mainFlow[1] ? { mainFlow } : {}),
    ...(isIdentityST(mainTO) ? {} : { mainTO }),
    ...((f._VRepeatSwitch ?? 1) === 0 ? { vClamp: true } : {}),
    // 主貼圖是 white 時取 R 沒有差別，不輸出
    ...(main && f._ChannelChoose ? { channelR: true } : {}),
    ...(colName
      ? { colorTex: { ...tx(colName, colWhat), ...(isIdentityST(colST) ? {} : { st: colST }), ...(f._ColorRotate ? { rotate: deg(f._ColorRotate) } : {}) } }
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
    ...(main2 ? { main2 } : {}),
  }
}

/**
 * CanvasGroup 的 alpha（Unity：自己與祖先每個開著的 CanvasGroup 相乘，碰到 m_IgnoreParentGroups 的就不再往上乘）。
 * 10-29 盤點 64 台只有兩個 <1：2013 烈焰的 Fx_Glow（0.01）、3027 的 Root_SweepLight（0.35，另有 Animator）。
 * 目前只有 imageLayer 乘進顏色；其他系統／圖層遇到就報 ⚠（盤點時都沒有）
 */
function groupAlpha(i, animAlpha = anim0?.alpha) {
  let a = 1
  for (let x = i; x != null; x = nodes[x].parent) {
    const g = nodes[x].canvasGroup
    if (!g || g.m_Enabled === 0) continue
    a *= animAlpha?.get(x) ?? g.m_Alpha ?? 1
    if (g.m_IgnoreParentGroups) break
  }
  return a
}

/**
 * Image＋UIFx_Alpha（粒子材質掛在 Image 上，10-29 補，2013 烈焰的四層光暈）：畫成一張轉過的矩形，貼圖 × Image 顏色 × CanvasGroup alpha ×
 * _Color_Str，混色照 _Dst3，跟粒子同一支 shader。UIFx_Alpha 取的是 _Tex（不是 _MainTex），所以 Image 沒掛 sprite 時 UV 是整張。
 * sprite、非 Simple 的 Image 類型會換掉 UV／網格，匯出檔又沒有 sprite，遇到就報 ⚠
 */
function imageLayer(n, i, img, at) {
  const m = D.materials[img.material], f = m.floats, owner = `${n.name}：材質 ${img.material}（UIFx_Alpha）`
  const geom = flowGeom(n, at, owner)
  if (img.fields.m_Sprite?.pid && img.fields.m_Sprite.pid !== '0') warn(`${owner}：Image 掛了 sprite，引擎當成整張貼圖`)
  if (img.fields.m_Type) warn(`${owner}：Image 類型 ${img.fields.m_Type}（不是 Simple），引擎畫成整張矩形`)
  // _Color（10-29 補，10103119 希兒薇的翅膀 L／R 是藍色 0.42, 0.57, 0.75）：shader＝貼圖 × 頂點色 × _Color × _Color_Str
  // （shaders/UIFx_Alpha/ 的反組譯），白色不輸出（已上站的 JSON 不變）
  const tint = (m.colors._Color ?? [1, 1, 1, 1]).map(num)
  const dst = f._Dst3 ?? 1
  if (dst !== 1 && dst !== 10) warn(`${owner} 的混色 SrcAlpha／${dst} 引擎不支援（只有 1＝疊加、10＝透明），當成疊加`)
  const c = img.fields.m_Color, ga = groupAlpha(i)
  return {
    name: n.name,
    ...geom,
    shader: 'alpha',
    color: [num(c.r), num(c.g), num(c.b), num(c.a * ga)],
    tex: useTex((m.tex._Tex ?? m.tex._MainTex)?.tex, `${owner} 的主貼圖`),
    strength: num(f._Color_Str ?? 1),
    ...(isWhite(tint) ? {} : { tint }),
    ...(dst === 10 ? { blend: 'alpha' } : {}),
  }
}

/**
 * Image＋ProjectFM/UI/SpeedLine（10-29 補，10103118 艾達、10103154 蘿莎的 Particle_Glow_Circle_2／3：機體後面往外噴的速度線光圈）。
 * 公式見 gachaFxTypes.ts 的 FxSpeedLine（反組譯在 shaders/SpeedLine/）。shader 只讀 17 個屬性，材質上其他的（_Color、_MainTexRotate…）是殘值。
 * _Color1／_Color2 在 shader 裡是 float，Unity 把材質的 Color 取 x 傳進去。屬性沒存時用 shader 的預設（m_PropInfo）。
 * 貼圖只有 _CustumMaskOn 開著才讀（兩位都沒開，不輸出、不複製）
 */
const SPEEDLINE_DEF = { _Rotate: 0, _ColorWeight: 0.5, _ColorScale: 0, _radialColorOn: 1, _MaskInner: 0.6, _MaskOutter: 0.6, _MaskBlur: 0.1,
  _CustumMaskOn: 0, _OffsetX: 0.5, _OffsetY: 0.5, _U: 1, _V: 2, _Density: 10, _Speed: 1, __SimpleNoise: 0 }
function speedLineLayer(n, img, at, m = D.materials[img.material]) {
  const owner = `${n.name}：材質 ${img.material}（SpeedLine）`
  const f = (k) => num(m.floats[k] ?? SPEEDLINE_DEF[k])
  if (img.fields.m_Sprite?.pid && img.fields.m_Sprite.pid !== '0') warn(`${owner}：Image 掛了 sprite，引擎當成整張（UV 0～1）`)
  if (img.fields.m_Type) warn(`${owner}：Image 類型 ${img.fields.m_Type}（不是 Simple），引擎畫成整張矩形`)
  const st = texST(m.tex._MainTex), c = img.fields.m_Color
  return {
    name: n.name,
    ...flowGeom(n, at, owner),
    shader: 'speedLine',
    color: [num(c.r), num(c.g), num(c.b), num(c.a)],
    ...(f('_Rotate') ? { rotate: f('_Rotate') } : {}),
    ...(isIdentityST(st) ? {} : { st }),
    offset: [f('_OffsetX'), f('_OffsetY')],
    u: f('_U'), v: f('_V'), speed: f('_Speed'), density: f('_Density'),
    ...(f('__SimpleNoise') ? { simpleNoise: true } : {}),
    color1: num(m.colors._Color1?.[0] ?? 0), color2: num(m.colors._Color2?.[0] ?? 1),
    colorWeight: f('_ColorWeight'), colorScale: f('_ColorScale'),
    ...(f('_radialColorOn') ? { radial: true } : {}),
    maskInner: f('_MaskInner'), maskOuter: f('_MaskOutter'), maskBlur: f('_MaskBlur'),
    ...(f('_CustumMaskOn') ? { maskTex: useTex(m.tex._MainTex?.tex, `${owner} 的遮罩貼圖`) } : {}),
  }
}

/**
 * 預設 UI 材質的 RawImage＝招募插畫的另一塊切片（10-29 起）：3027 巨像的無人機（Plane01，探照燈的父節點，跟著片段飄）、
 * 前景的鋼樑（Stone），1027、2019、2042、3005、3019、3032 的廢墟／石塊／路障也是。站上的插畫只拼了 BG_01／BG_02 兩片，
 * 這些塊 10-29 前都沒畫。UI/Default＝貼圖×頂點色、一般透明，等於粒子 shader 強度 1 的透明混色，所以畫成 shader 'alpha' 的圖層。
 * 只認貼圖名是招募插畫（Img_1_mechcard_illustration_）的：其他預設材質的 RawImage／Image（1035、2050 的 Mask、2057 的 Img_Mask）
 * 多半是遮罩，照舊不畫。
 * 機師（10-29 起）：兩片背景是 RawImage 的 Img_01／Img_02，切片貼圖叫 Img_1_pilot_gacha_；掛 sprite 的 Image 也是切片
 * （匯出時裁成整張，菲婭的 Img_03、帕洛瑪的 Word…）。其他看得到、預設材質又沒畫的 Image／RawImage 報 ⚠（機甲照舊不報）。
 */
/**
 * UIShiny（UIEffect 3.x 的掃光，10-29 補；10103164 瑪蒂妮的 SweepLight／SweepLight02，片段動 m_EffectFactor）。
 * shader 是 globalgamemanagers.assets 的 Hidden/UI/Default (UIShiny)（反組譯在 shaders/UIShiny/，公式見 gachaFxEngine.ts 的 FS_SHINY）；
 * 參數經 8 位元的參數貼圖傳（UIEffect 的 ParameterTexture：(byte)(Clamp01(v)×255)），所以這裡先量化。
 * 位置是 UIEffect 的 Matrix2x3 逐頂點算的（遊戲是 IL2CPP，照 UIEffect 3.x 原始碼）：方向 (cos r, sin r) 的 x 乘高／寬再正規化成 (c, s)，
 * 頂點的位置＝s×(x／寬－0.5)＋c×(y／高－0.5)＋0.5，夾到 0～1、量化成 12 位元（Packer.ToFloat）後在三角形上內插——
 * 四個角夾過以後不是線性的，所以輸出四個角的值（左下、右下、右上、左上），引擎照同一條對角線分三角形內插。
 * 只做 m_Player.play＝0（不自動播，位置由片段或元件的值決定）、m_EffectArea＝0（RectTransform）的。
 * 自動播的（10103155 的 Gun_Glow、10103127、10103157）記 note、不畫：10103155 已上站，改了會變動已上站的卡池，要另外確認
 */
const byte = (v) => Math.floor(Math.min(1, Math.max(0, v)) * 255) / 255
function shinyLayer(n, i, owner) {
  const sh = shinyOf(n)
  if (!sh) return undefined
  const F = sh.fields
  if (F.m_Player?.play) { note(`${owner}：UIShiny 會自動播放（duration ${F.m_Player.duration}、loopDelay ${F.m_Player.loopDelay}），引擎還沒做，沒畫掃光`); return undefined }
  if (F.m_EffectArea) warn(`${owner}：UIShiny 的 m_EffectArea＝${F.m_EffectArea}（不是 RectTransform），引擎不支援`)
  const factor = anim0?.shiny.get(i) ?? F.m_EffectFactor ?? 0
  return {
    factor: num(byte(factor)), width: num(byte(F.m_Width ?? 0.25)), softness: num(byte(F.m_Softness ?? 1)),
    brightness: num(byte(F.m_Brightness ?? 1)), gloss: num(byte(F.m_Gloss ?? 1)),
    corners: shinyCorners(i, anim0?.shinyRot.get(i) ?? F.m_Rotation ?? 0),
  }
}
/** UIShiny 四個角的位置（左下、右下、右上、左上）；rot＝m_Rotation（度）。片段動 m_Rotation 時（10-29 補，10103171 戰部渡的 FX_Scales）逐格算 */
function shinyCorners(i, rot) {
  const [w, h] = layout[i].size
  const r = rot * Math.PI / 180
  let c = Math.cos(r) * h / w, s = Math.sin(r)
  const len = Math.hypot(c, s)
  c /= len; s /= len
  const corner = (u, v) => num(Math.floor(Math.min(1, Math.max(0, s * u + c * v + 0.5)) * 4095) / 4096)
  return [corner(-0.5, -0.5), corner(0.5, -0.5), corner(0.5, 0.5), corner(-0.5, 0.5)]
}

const TILE = isPilot ? /^Img_0[12]$/ : /^BG_0[12]$/
const PIECE_TEX = isPilot ? /^Img_1_pilot_gacha_/ : /^Img_1_mechcard_illustration_/
const isTile = (n, mb) => mb.script === 'RawImage' && TILE.test(n.name)
const isCardPiece = (n, mb) => !mb.material && !isTile(n, mb) && ((mb.script === 'RawImage' && PIECE_TEX.test(mb.texture ?? ''))
  || (isPilot && mb.script === 'Image' && !!mb.sprite && !isMaskGraphic(n)) || (isOtherPiece(n, mb) && !!mb.texture))
/** 掛 Mask 元件、不顯示自己的 Image：只寫模板，不畫 */
const isMaskGraphic = (n) => (n.mb ?? []).some((b) => b.script === 'Mask' && b.fields?.m_Enabled !== 0 && !b.fields?.m_ShowMaskGraphic)
/**
 * 機師：看得到、預設材質、有貼圖或 sprite，不是背景、貼圖名也不是 Img_1_pilot_gacha_ 的 Image／RawImage。
 * 10-29 起這些 RawImage 也照切片畫（UI/Default＝貼圖×頂點色、一般透明，跟切片一樣）：綾波零的 Img_Mask01／02、智者的 RawImg_People
 * 是插畫的前景切片（貼圖叫 Img_1_pilot_<名字>N_Raw，少了 gacha_），亞瑟的 Img_04 是箭頭圖示 T_UIFX_workshop_arrow03_SAC。
 * 只剩匯出檔沒有貼圖／sprite 的報 ⚠
 */
const isOtherPiece = (n, mb) => isPilot && !mb.material && (mb.script === 'Image' || mb.script === 'RawImage') && !isTile(n, mb)
  && !isMaskGraphic(n) && mb.fields?.m_Enabled !== 0 && (mb.fields?.m_Color?.a ?? 1) > 0.01
  && ((mb.script === 'Image' ? mb.fields?.m_Sprite : mb.fields?.m_Texture)?.pid ?? '0') !== '0'
const isUndrawnPiece = (n, mb) => isOtherPiece(n, mb) && !isCardPiece(n, mb)
/**
 * Image 的 Filled（type 3，10-29 補，10103140 哈德威的滑桿 Vertical、扇形與螢幕 Radial360）：照 uGUI 的 GenerateFilledSprite 在引擎裡切
 * （gachaFxFlow1.ts 的 fillQuads），片段動 m_FillAmount 的烘成 anim.fill。Radial90／180 沒做，報 ⚠ 照整張畫
 */
function fillOf(n, i, img, owner) {
  const F = img.fields
  if (F.m_FillMethod !== 0 && F.m_FillMethod !== 1 && F.m_FillMethod !== 4) { warn(`${owner}：Filled 的方式 ${F.m_FillMethod}（Radial90／180）引擎不支援，照整張畫`); return undefined }
  return { method: F.m_FillMethod, origin: F.m_FillOrigin ?? 0, clockwise: !!F.m_FillClockwise, amount: num(anim0?.fill.get(i) ?? F.m_FillAmount ?? 1) }
}
/** additive：Image＋UIAdditive（10-29 補，哈德威的 Line_01／02、扇形、螢幕）＝同切片但疊加，乘材質 _Color */
function cardPieceLayer(n, i, img, at, additive = false) {
  const tex = img.texture ?? img.sprite
  const owner = `${n.name}：插畫切片 ${tex}`
  const u = img.fields.m_UVRect
  if (u && (u.x || u.y || u.width !== 1 || u.height !== 1)) warn(`${owner}：RawImage 的 uvRect 不是整張（${JSON.stringify(u)}），引擎不支援`)
  const fill = img.script === 'Image' && img.fields.m_Type === 3 ? fillOf(n, i, img, owner) : undefined
  if (img.script === 'Image' && img.fields.m_Type && img.fields.m_Type !== 3) warn(`${owner}：Image 類型 ${img.fields.m_Type}（不是 Simple／Filled），引擎照整張拉滿畫`)
  const tint = additive ? (D.materials[img.material]?.colors._Color ?? [1, 1, 1, 1]).map(num) : null
  if (img.script === 'Image' && img.fields.m_PreserveAspect) warn(`${owner}：Image 開了 preserveAspect，引擎照整張拉滿畫`)
  if (ancestors(n).some((a) => (a.mb ?? []).some((b) => b.script === 'Mask' && b.fields?.m_Enabled !== 0))) warn(`${owner}：在 Mask（模板遮罩）底下，引擎不裁`)
  const c = img.fields.m_Color, shiny = shinyLayer(n, i, owner)
  return {
    name: n.name,
    ...flowGeom(n, at, owner),
    shader: 'alpha',
    color: [num(c.r), num(c.g), num(c.b), num(c.a * groupAlpha(i))],
    tex: useTex(tex, `${owner} 的貼圖`),
    strength: 1,
    ...(tint && !isWhite(tint) ? { tint } : {}),
    ...(additive ? {} : { blend: 'alpha' }),
    ...(shiny ? { shiny } : {}),
    ...(fill ? { fill } : {}),
  }
}

const systems = [], flows = []
/** 輸出的系統／圖層在 nodes 裡的位置（排繪製順序用） */
const sysAt = [], flowAt = [], flowMb = []
const addFlow = (fl, i, mb) => { flows.push(fl); flowAt.push(i); flowMb.push(mb) }
/** prefab 裡關著、但每個關著的（自己或祖先）都有片段的 m_IsActive 軌：片段會打開它（艾達的 Particle_Star02） */
const toggledOn = (i) => !!animation && [nodes[i], ...ancestors(nodes[i])].every((a) => a.active !== false || animation.switched(nodes.indexOf(a)))
for (const [i, n] of nodes.entries()) {
  if (!isActive(n) && !(n.ps && toggledOn(i))) continue
  if (n.ps && unlisted(i)) {
    if (!n.psr?.m_Enabled) { note(`${n.name}：不在 UIParticle 的 m_Particles 清單裡、renderer 也關著，遊戲不畫，略過`); continue }
    note(`${n.name}：不在 UIParticle 的 m_Particles 清單裡，遊戲由它自己的 renderer 畫（非 UI），大小與順序待對遊戲畫面`)
  }
  if (n.ps) {
    const s = particleSystem(n, layout[i]), act = animation?.activeOf(i)
    if (s && act === 'mixed') warn(`${n.name}：被不同長度的片段開關（m_IsActive），引擎不支援，照一直開著畫`)
    else if (s && act && !act.on.length) { note(`${n.name}：片段一直把它關著，遊戲不畫，略過`); continue }
    else if (s && act) s.active = act
    if (s) { systems.push(s); sysAt.push(i) }
    continue
  }
  for (const mb of n.mb ?? []) {
    // 被上色的軌動到的：靜止的欄位用片段第 0 秒的顏色與材質（同 layout）
    const { img, m } = animation?.shaded(i) ? shadeAt(i, mb, anim0) : { img: mb }
    if (isCardPiece(n, mb)) { addFlow(cardPieceLayer(n, i, img, layout[i]), i, mb); continue }
    if (mb.script === 'Image' && mb.sprite && D.materials[mb.material]?.shader === SHADER_UIADD) { addFlow(cardPieceLayer(n, i, img, layout[i], true), i, mb); continue }
    if (isUndrawnPiece(n, mb)) warn(`${n.name}：預設材質的 ${mb.script} 掛了${mb.script === 'Image' ? ` sprite ${mb.sprite ?? '（匯出檔沒有）'}` : ` 貼圖 ${mb.texture ?? '（匯出檔沒有）'}`}，引擎不畫`)
    if (!mb.material) continue
    if (shinyOf(n) && (mb.script === 'Image' || mb.script === 'RawImage')) warn(`${n.name}：掛材質的 ${mb.script} 有 UIShiny，引擎只在插畫切片上畫掃光`)
    const shader = D.materials[mb.material]?.shader
    if (mb.script === 'Image' && shader === SHADER_FLOW) addFlow(flowLayer(n, img, layout[i], m), i, mb)
    else if ((mb.script === 'Image' || mb.script === 'RawImage') && shader === SHADER_FLOW1) addFlow(flow1Layer(n, img, layout[i], m), i, mb)
    else if (mb.script === 'Image' && shader === SHADER_PARTICLE) addFlow(imageLayer(n, i, img, layout[i]), i, mb)
    else if (mb.script === 'Image' && shader === SHADER_SPEEDLINE) addFlow(speedLineLayer(n, img, layout[i], m), i, mb)
    else if (mb.script === 'Image' && shader === SHADER_UI_COMMON) addFlow(uiCommonLayer(n, img, layout[i], m), i, mb)
    else if (mb.script === 'Image' && shader === SHADER_GENERAL) addFlow(generalLayer(n, img, layout[i], m), i, mb)
    else if (shader) warn(`${n.name}：${mb.script} 用了材質 ${mb.material}（${shader}），引擎不畫`)
  }
}
// CanvasGroup alpha：imageLayer、cardPieceLayer 自己乘了；流動圖層（10-29 起，3027 巨像的 Light02/04/05/06）在這裡乘進頂點色的 alpha
// ——兩支流動 shader 的 alpha 都乘頂點 a，和 Unity 的 CanvasGroup 一樣。60 台裡只有 2013、3027 有 alpha < 1 的 CanvasGroup，其他台 JSON 不變。
// 粒子沒乘，報 ⚠（目前沒有一台在 CanvasGroup 底下）
flows.forEach((fl, j) => {
  fl.alpha0 = fl.shader === 'alpha' ? fl.color[3] / (groupAlpha(flowAt[j]) || 1) : fl.color[3]
  if (fl.shader !== 'alpha') { const ga = groupAlpha(flowAt[j]); if (ga < 1) fl.color[3] = num(fl.color[3] * ga) }
})
for (const i of sysAt) {
  const ga = groupAlpha(i)
  if (ga < 1) warn(`${nodes[i].name}：CanvasGroup 的 alpha ${num(ga)}，引擎沒乘（會畫得比遊戲亮）`)
}

/**
 * Animator 片段烘成逐格的軌（見 animation）：anim＝{ len（秒，循環）, quad（每格 6 個數，同 layerQuad）, alpha?（每格頂點 alpha，
 * 只有 CanvasGroup alpha 被動到的層才有）}。格數 round(len × ANIM_FPS)＋1，最後一格＝片段結尾（循環時等於第 0 格）。
 */
if (animation) {
  const hit = flows.map((_, j) => animation.touches(flowAt[j]))
  const shaded = flows.map((_, j) => animation.shaded(flowAt[j]))
  sysAt.forEach((i, k) => { if (animation.touches(i)) animMove(k) })
  for (const i of flowAt) if (animation.activeOf(i)) warn(`${nodes[i].name}：圖層（或祖先）被片段開關（m_IsActive），引擎只對粒子系統做，照一直開著畫`)
  if (hit.some(Boolean) || shaded.some(Boolean)) {
    const N = Math.max(1, Math.round(animation.len * animation.fps))
    const frames = Array.from({ length: N + 1 }, (_, k) => animation.at((k * animation.len) / N))
    flows.forEach((fl, j) => {
      if (!hit[j] && !shaded[j]) return
      const i = flowAt[j], mb = flowMb[j]
      // 頂點 alpha 除了 Image 顏色的 a 以外的係數：流動圖層與 UI_General（10-31 起）乘了材質 _Color 的 a，shader 'alpha' 的圖層沒乘
      const kA = fl.shader == null || fl.shader === 'flow1' || fl.shader === 'general' ? (D.materials[mb.material]?.colors._Color?.[3] ?? 1) : 1
      const alpha = frames.map((f) => {
        const a = f.graphicA.get(i)
        return Math.round((a == null ? fl.alpha0 : a * kA) * groupAlpha(i, f.alpha) * 1000) / 1000
      })
      const props = {}
      for (const name of Object.keys(anim0.props.get(i) ?? {})) {
        const kind = fl.shader ?? 'flow', t = PROP_TRACKS[kind]?.[name]
        if (!t) warn(`${nodes[i].name}：片段經 UIShaderVariableProxy 動到材質屬性 ${name}（${kind} 圖層），引擎不支援，照第 0 秒畫`)
        else if (!t[2](fl)) note(`${nodes[i].name}：片段經 UIShaderVariableProxy 動到 ${name}，但圖層沒有用到它的那一段，不影響`)
        else props[t[0]] = frames.flatMap((f) => t[1](shadeAt(i, mb, f).m))
      }
      if (fl.shiny && anim0.shiny.has(i)) props.shiny = frames.map((f) => num(byte(f.shiny.get(i))))
      else if (anim0.shiny.has(i)) warn(`${nodes[i].name}：片段動到 UIShiny 的 m_EffectFactor，但這層沒畫掃光，引擎不支援`)
      if (fl.fill && anim0.fill.has(i)) props.fill = frames.map((f) => num(f.fill.get(i)))
      else if (anim0.fill.has(i)) warn(`${nodes[i].name}：片段動到 m_FillAmount，但這層不是 Filled 的 Image，引擎不支援`)
      if (fl.shiny && anim0.shinyRot.has(i)) props.shinyCorners = frames.flatMap((f) => shinyCorners(i, f.shinyRot.get(i)))
      else if (anim0.shinyRot.has(i)) warn(`${nodes[i].name}：片段動到 UIShiny 的 m_Rotation，但這層沒畫掃光，引擎不支援`)
      const anim = {
        len: num(animation.len),
        ...(hit[j] ? { quad: frames.flatMap((f) => layerQuad(f.layout[i], px10)) } : {}),
        ...(alpha.some((a) => a !== alpha[0]) ? { alpha } : {}),
        ...props,
      }
      if (Object.keys(anim).length > 1) fl.anim = anim
    })
  }
}
for (const fl of flows) delete fl.alpha0
/**
 * 粒子系統（或祖先）被 Animator 片段動到（10-29 補）：逐格算系統節點的世界變換，跟第 0 秒比。
 * 畫面上的 2×3（M 的 xy 兩列）變不到 0.01、位置差不到 1 px：看不出來，記 note 照靜止畫。
 * local 空間（moveWithTransform 0）、只有平移的：烘成 move（同 TweenPos2，引擎整組平移；10103134 奧菲莉亞的 Plane01 飄 ±3 px，
 * 底下的眼光、螺旋槳 8 個系統）。local 空間被轉／縮放的照舊報 ⚠。
 * world 空間（1）、縮放不變的：烘成 emitter＝{ len, d（每格 dx, dy（相對 pos 的畫布像素）、世界旋轉 qx, qy, qz, qw）}，引擎只在
 * 發射時用這一格的位置與旋轉，已發射的粒子留在原地（10103119 希兒薇的蝴蝶：Root 斜擺在 3D 裡，Root_Butterfly 沿 z 飛 0～−34、
 * x 軸轉 0～12°，Particle_1 拖著的粉塵、Particle_2 周圍的光點）。每秒 30 格（片段的關鍵格每 1/6 秒一個）。
 * 力場／速度等模組的 local 方向照舊用第 0 秒的旋轉。
 */
function animMove(k) {
  const i = sysAt[k], n = nodes[i], L0 = layout[i], world = n.ps.moveWithTransform === 1
  const N = Math.max(1, Math.round(animation.len * (world ? 30 : ANIM_FPS)))
  const frames = Array.from({ length: N + 1 }, (_, f) => animation.at((f * animation.len) / N).layout[i])
  const col = (M, c) => Math.hypot(M[0][c], M[1][c], M[2][c])
  let dM = 0, dT = 0, dS = 0
  for (const L of frames) {
    for (const r of [0, 1]) for (const c of [0, 1, 2]) dM = Math.max(dM, Math.abs(L.M[r][c] - L0.M[r][c]))
    for (const c of [0, 1, 2]) dS = Math.max(dS, Math.abs(col(L.M, c) - col(L0.M, c)))
    dT = Math.max(dT, Math.abs(L.t[0] - L0.t[0]), Math.abs(L.t[1] - L0.t[1]))
  }
  const owner = `${n.name}：粒子系統（或祖先）被 Animator 片段動到`
  if (dM < 0.01 && dT < 1) note(`${owner}，但畫面上最多移 ${num(dT)} px、旋轉縮放差 ${num(dM)}，看不出來，照靜止畫`)
  else if (world) {
    if (dS >= 0.01) { warn(`${owner}（world 空間，縮放差 ${num(dS)}），引擎不支援`); return }
    let prev = L0.q
    systems[k].emitter = {
      len: num(animation.len),
      d: frames.flatMap((L) => {
        // 四元數 q、−q 同一個旋轉：取跟前一格同側的，線性內插才不會繞遠路
        const q = L.q[0] * prev[0] + L.q[1] * prev[1] + L.q[2] * prev[2] + L.q[3] * prev[3] < 0 ? L.q.map((v) => -v) : L.q
        prev = q
        return [px10(L.t[0] - L0.t[0]), px10(L.t[1] - L0.t[1]), ...q.map((v) => Math.round(v * 1e4) / 1e4)]
      }),
    }
  }
  else if (n.ps.moveWithTransform !== 0) warn(`${owner}（模擬空間 ${n.ps.moveWithTransform}），引擎不支援`)
  else if (dM >= 0.01) warn(`${owner}（旋轉／縮放，差 ${num(dM)}），引擎不支援`)
  else systems[k].move = { len: num(animation.len), d: frames.flatMap((L) => [px10(L.t[0] - L0.t[0]), px10(L.t[1] - L0.t[1])]) }
}

/**
 * Tween 類元件（TweenAlpha／TweenScale…，遊戲自己的 UITweener 系列）會在執行時改顏色或變換。
 * 61 台只有 1035 海拉的 Flash_Mask01、2014 的 BG_Fx 在畫的節點上掛 TweenAlpha。
 * 10-29 起，圖層自己身上的 TweenAlpha 照 NGUI 的 UITweener 語意烘成 alpha 軌（anim.alpha，引擎和 Animator 的軌共用）：
 *   factor＝經過時間÷duration，style 1 Loop 取小數、2 PingPong 來回（一輪 2×duration）；method 0 Linear；
 *   再過 functionCurve（AnimationCurve，空的＝原樣），值＝lerp(from, to, 曲線值)，取代 Image 顏色的 a（材質色、CanvasGroup 照乘）。
 * 欄位名和 NGUI 一樣，但遊戲是 IL2CPP、沒有原始碼可對，這是照欄位推的語意，試作頁可以關掉比較。
 * 2014 金剛狼的 BG_Fx：from 0.5、to 0.8、6 秒 Loop，曲線 0→1→0，所以是 6 秒一次的呼吸（0.5～0.8），靜止的 a 0.843 用不到。
 * 其他情況（粒子、祖先上的、Once、非 Linear、delay、和 Animator 的軌疊在同一層、TweenScale…）照舊報 ⚠、照靜止畫。
 */
/** AnimationCurve（keys：time／value／inSlope／outSlope，非加權）在 t 的值；範圍外取端點 */
function evalAnimCurve(keys, t) {
  if (!keys.length) return t
  if (t <= keys[0].time) return keys[0].value
  for (let k = 0; k + 1 < keys.length; k++) {
    const a = keys[k], b = keys[k + 1]
    if (t > b.time) continue
    const d = b.time - a.time, s = (t - a.time) / d, s2 = s * s, s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * a.value + (s3 - 2 * s2 + s) * d * a.outSlope + (-2 * s3 + 3 * s2) * b.value + (s3 - s2) * d * b.inSlope
  }
  return keys[keys.length - 1].value
}
function tweenAlpha(j, tw) {
  const i = flowAt[j], fl = flows[j], f = tw.fields, owner = `${nodes[i].name}：TweenAlpha`
  const img = (nodes[i].mb ?? []).find((b) => b.script === 'Image' || b.script === 'RawImage')
  const a0 = img?.fields?.m_Color?.a
  const why = f.style !== 1 && f.style !== 2 ? `style ${f.style}（只做 Loop 1／PingPong 2）`
    : f.method !== 0 ? `method ${f.method}（只做 Linear 0）`
    : f.delay ? `delay ${f.delay}` : !(f.duration > 0) ? `duration ${f.duration}`
    : fl.anim ? '同一層已有 Animator 的軌' : !a0 ? 'Image 顏色的 a 是 0，換算不出材質色' : f.fromOffset || f.toOffset ? 'fromOffset／toOffset 不是 0' : ''
  if (why) { warn(`${owner} 會在執行時做動畫，${why}，引擎不支援`); return }
  const len = f.style === 2 ? 2 * f.duration : f.duration
  // 一輪至少 60 格：1035 海拉的曲線是閃電式的閃爍（1.5 秒裡 9 個點、最近的相隔 0.05 秒），每秒 10 格會把它抹平
  const N = Math.max(60, Math.round(len * ANIM_FPS))
  const keys = f.functionCurve?.m_Curve ?? []
  const alpha = Array.from({ length: N + 1 }, (_, k) => {
    let x = (k / N) * len / f.duration
    x = f.style === 2 ? (x <= 1 ? x : 2 - x) : (k === N ? 1 : x % 1)
    const v = f.from + (f.to - f.from) * evalAnimCurve(keys, x)
    return Math.round((fl.color[3] / a0) * v * 1000) / 1000
  })
  fl.color[3] = alpha[0]
  fl.anim = { len: num(len), alpha }
}
flowAt.forEach((i, j) => {
  const tw = (nodes[i].mb ?? []).find((b) => b.script === 'TweenAlpha' && b.fields?.m_Enabled !== 0)
  if (tw) tweenAlpha(j, tw)
})
/**
 * TweenPos2（10-29 補，10103153 帕洛瑪的 Image 與底下的煙 Particle_Smoke_5）：遊戲自己的位移 tween，欄位同 NGUI 的 TweenPosition
 * 再加 CSpace。帕洛瑪的 from／to 是 (472, 260)→(472, 250)、x 等於 anchoredPosition（prefab 存的 y 265 不會出現），所以 CSpace 1
 * 當成 anchoredPosition（只做這種）。factor 與曲線同 TweenAlpha，值＝lerp(from, to, 曲線值)。
 * 底下的圖層烘成 anim.quad；粒子系統只做 local 空間的（moveWithTransform 0：粒子跟著節點走），輸出 move＝{ len, d（每格的 dx, dy，
 * 相對 pos 的畫布像素）}，引擎畫的時候整組平移。world 空間的粒子、已有別的動畫軌、被 Animator 動到的，照舊報 ⚠。
 */
const tweenDone = new Set()
function tweenPos(x, tw) {
  const f = tw.fields, owner = `${nodes[x].name}：TweenPos2`
  const under = (i) => { for (let y = i; y != null; y = nodes[y].parent) if (y === x) return true; return false }
  const fj = flowAt.flatMap((i, j) => (under(i) ? [j] : [])), sk = sysAt.flatMap((i, k) => (under(i) ? [k] : []))
  const why = f.style !== 1 && f.style !== 2 ? `style ${f.style}（只做 Loop 1／PingPong 2）`
    : f.method !== 0 ? `method ${f.method}（只做 Linear 0）`
    : f.delay ? `delay ${f.delay}` : !(f.duration > 0) ? `duration ${f.duration}`
    : f.CSpace !== 1 ? `CSpace ${f.CSpace}（只做 1）` : f.fromOffset || f.toOffset ? 'fromOffset／toOffset 不是 0'
    : !nodes[x].rect?.m_AnchorMin ? '節點不是 RectTransform'
    : [...fj.map((j) => flowAt[j]), ...sk.map((k) => sysAt[k])].some((i) => animation?.touches(i)) ? '底下有被 Animator 動到的'
    : fj.some((j) => flows[j].anim) ? '底下的圖層已有別的動畫軌'
    : sk.some((k) => nodes[sysAt[k]].ps.moveWithTransform !== 0) ? '底下有 world 空間的粒子系統'
    : sk.some((k) => systems[k].move) ? '底下的粒子系統已有位移軌' : ''
  if (why) { warn(`${owner} 會在執行時做動畫，${why}，引擎不支援`); return }
  const len = f.style === 2 ? 2 * f.duration : f.duration
  const N = Math.max(60, Math.round(len * ANIM_FPS))
  const keys = f.functionCurve?.m_Curve ?? []
  const frames = Array.from({ length: N + 1 }, (_, k) => {
    let u = (k / N) * len / f.duration
    u = f.style === 2 ? (u <= 1 ? u : 2 - u) : (k === N ? 1 : u % 1)
    const c = evalAnimCurve(keys, u)
    const p = { x: f.from.x + (f.to.x - f.from.x) * c, y: f.from.y + (f.to.y - f.from.y) * c }
    return buildLayout((i) => (i === x ? { ...nodes[i].rect, m_AnchoredPosition: p } : nodes[i].rect))
  })
  for (const j of fj) flows[j].anim = { len: num(len), quad: frames.flatMap((L) => layerQuad(L[flowAt[j]], px10)) }
  for (const k of sk) {
    const i = sysAt[k], t0 = layout[i].t
    systems[k].move = { len: num(len), d: frames.flatMap((L) => [px10(L[i].t[0] - t0[0]), px10(L[i].t[1] - t0[1])]) }
  }
  tweenDone.add(tw)
}
nodes.forEach((n, x) => {
  for (const b of n.mb ?? []) if (b.script === 'TweenPos2' && b.fields?.m_Enabled !== 0 && drawsBelow(x)) { tweenPos(x, b); tweenDone.add(b) }
})
/**
 * TweenRot（10-29 補，10103118 艾達的 Rotation／1～6：六支箭頭光各自 40～50 秒繞中心轉一圈）：欄位同 TweenPos2，值＝Euler(lerp(from, to, 曲線值))
 * 寫進 localRotation（prefab 存的角度不會出現）。只做「只轉 z、整圈（360° 的倍數）、線性曲線、Loop」的：這種一直等速轉，接縫看不出來，
 * 所以不烘逐格的四角（50 秒×每秒 10 格×6 層會多 100 KB），輸出 spin＝{ c（節點 pivot 的畫布座標）, w（弧度／秒）}，引擎把四角再繞 c 轉 w×時間。
 * delay 當成相位（穩定後的樣子：時間 t 的進度＝(t−delay)÷duration）；遊戲裡頭 delay 秒停在 prefab 的角度，這裡沒做。
 * 第 0 秒的角度用 buildLayout 重算底下圖層的 pos／size／rot／quad（裁切照舊）。底下有粒子、圖層已有 Animator 的四角軌、祖先傾斜或巢狀的照舊報 ⚠
 */
function tweenRot(x, tw) {
  const f = tw.fields, owner = `${nodes[x].name}：TweenRot`
  const under = (i) => { for (let y = i; y != null; y = nodes[y].parent) if (y === x) return true; return false }
  const fj = flowAt.flatMap((i, j) => (under(i) ? [j] : [])), sk = sysAt.filter(under)
  const dz = f.to?.z - f.from?.z, turns = dz / 360
  const keys = f.functionCurve?.m_Curve ?? []
  const P = layout[x].parent, det = P.M[0][0] * P.M[1][1] - P.M[0][1] * P.M[1][0]
  const why = f.style !== 1 ? `style ${f.style}（只做 Loop 1）` : f.method !== 0 ? `method ${f.method}（只做 Linear 0）`
    : !(f.duration > 0) ? `duration ${f.duration}` : f.fromOffset || f.toOffset ? 'fromOffset／toOffset 不是 0'
    : f.from.x || f.from.y || f.to.x || f.to.y ? '轉的不只 z 軸'
    : !(Math.abs(turns) >= 1 - 1e-6 && Math.abs(turns - Math.round(turns)) < 1e-6) ? `轉 ${num(dz)}°（只做整圈）`
    : [0.25, 0.5, 0.75].some((u) => Math.abs(evalAnimCurve(keys, u) - u) > 1e-6) ? '曲線不是線性'
    : Math.abs(P.q[0]) > 1e-4 || Math.abs(P.q[1]) > 1e-4 || Math.abs(Math.abs(det) - Math.hypot(P.M[0][0], P.M[1][0]) ** 2) > 1e-3 ? '祖先傾斜或非均勻縮放'
    : sk.length ? '底下有粒子系統' : fj.some((j) => flows[j].anim?.quad || flows[j].spin) ? '底下的圖層已有別的變換軌' : ''
  if (why) { warn(`${owner} 會在執行時做動畫，${why}，引擎不支援`); return }
  const u0 = (((-(f.delay ?? 0) / f.duration) % 1) + 1) % 1
  const a0 = (f.from.z + dz * u0) * Math.PI / 360
  const L = buildLayout((i) => (i === x ? { ...nodes[i].rect, m_LocalRotation: { x: 0, y: 0, z: Math.sin(a0), w: Math.cos(a0) } } : nodes[i].rect))
  const c = [num(L[x].t[0]), num(L[x].t[1])], w = num(Math.sign(det) * dz * Math.PI / 180 / f.duration)
  for (const j of fj) {
    const i = flowAt[j], { name, pos, size, rot, quad, ...rest } = flows[j]
    flows[j] = { name, ...flowGeom(nodes[i], L[i], owner, false), ...rest, spin: { c, w } }
  }
  tweenDone.add(tw)
}
nodes.forEach((n, x) => {
  for (const b of n.mb ?? []) if (b.script === 'TweenRot' && b.fields?.m_Enabled !== 0 && drawsBelow(x)) tweenRot(x, b)
})
for (const i of [...sysAt, ...flowAt]) {
  const own = flowAt.includes(i)
  for (let x = i; x != null; x = nodes[x].parent) {
    for (const b of nodes[x].mb ?? []) {
      if (!/^Tween/.test(b.script) || b.fields?.m_Enabled === 0 || tweenDone.has(b) || (own && x === i && b.script === 'TweenAlpha')) continue
      warn(`${nodes[i].name}：${x === i ? '' : `祖先 ${nodes[x].name} 的 `}${b.script} 會在執行時做動畫，引擎不支援`)
    }
  }
}

/**
 * 繪製順序（10-17 J-1 補）：Unity UI 照階層前序畫，UIParticle 在它的節點位置畫底下的粒子、Image 在自己的位置畫。
 * 引擎是「粒子全部畫完再畫流動圖層」；階層在所有 UIParticle 之前的圖層輸出 under，引擎先畫它（1028、2055、2061、3020 的 Flow1 圖層，
 * 其中 2061、3020 與 2055 的 Fire 是透明混色，畫在粒子後面會把粒子蓋住）。已上站各台的 UI_CommonFlow 圖層全在粒子之後，不受影響。
 * 夾在兩組粒子之間的圖層（10-29 起）：疊加的圖層跟疊加的粒子先後無關（加法可交換），只要對透明混色的粒子站對邊就跟遊戲一樣——
 * 透明粒子全在它後面就輸出 under、全在它前面就照常畫在最後。
 * 兩邊都有透明粒子、或圖層自己是透明混色（10-29 起，1051 奔霄的 Image02）：照遊戲分組——每個系統輸出 group（所屬 UIParticle 在階層裡是第幾個），
 * 圖層輸出 beforeGroup（它後面第一組的組號），引擎照組畫、組之間插圖層。只有需要時才輸出 group，其他多組 UIParticle 的機甲
 * 照舊全部照 sortingOrder 排，資料不變。
 * 已上站各台沒有夾在中間的圖層，不受影響；2013 烈焰的光暈因此能畫（透明粒子 FrontSmoke／Shoot 全在它前面）。
 */
const uiParticleOf = (i) => { for (let x = i; x != null; x = nodes[x].parent) if ((nodes[x].mb ?? []).some((b) => b.script === 'UIParticle')) return x; return i }
if (systems.length) {
  const at = sysAt.map(uiParticleOf), lo = Math.min(...at), hi = Math.max(...at)
  const alphaAt = at.filter((_, k) => systems[k].material.blend === 'alpha')
  const groups = [...new Set(at)].sort((a, b) => a - b)
  let grouped = false
  flows.forEach((fl, j) => {
    if (flowAt[j] < lo) fl.under = true
    else if (flowAt[j] < hi) {
      const before = alphaAt.some((x) => x < flowAt[j]), after = alphaAt.some((x) => x > flowAt[j])
      if (fl.blend !== 'alpha' && !before) fl.under = true
      else if (fl.blend === 'alpha' || after) { fl.beforeGroup = groups.findIndex((x) => x > flowAt[j]); grouped = true }
    }
  })
  if (grouped) systems.forEach((s, k) => { if (groups.indexOf(at[k])) s.group = groups.indexOf(at[k]) })
}

/**
 * 片段換 sprite 的序列幀（10-29 補，10103171 戰部渡的 Img_Sequence：60 張 620×512 的雲海，每 0.133 秒換一張、7.53 秒一輪）。
 * 片段的值是 pptr 表的索引（第一個關鍵格之前是 pre），Unity 的 Image 換 sprite 就是換整張圖。60 張 PNG 共 37 MB，所以拼成 WebP 圖集：
 * 每張不超過 4096×4096（行動裝置的貼圖上限），格子照原尺寸，品質 75（60 張約 2.4 MB）。名字是 <第 0 張的名字>_sheet<N>.webp，
 * 引擎看到 .webp 結尾就把網址的 .png 換成 .webp。圖層輸出 seq＝{ sheets, cols, rows, len, keys（攤平的 [時間, 幀]…，階梯） }，tex＝第一張圖集。
 * 只做插畫切片（預設材質、掛 sprite 的 Image）；其他的、或 sprite 尺寸不一的報 ⚠
 */
const sheetJobs = []
if (animation) flows.forEach((fl, j) => {
  const i = flowAt[j], S = animation.spriteOf(i)
  if (!S) return
  const owner = `${nodes[i].name}：片段換 sprite`
  const idx = [S.pre, ...S.keys.map((k) => k[4])].map((v) => Math.round(v))
  const names = [...new Set(idx)].sort((a, b) => a - b).map((k) => S.names[k])
  const dims = names.map((nm) => D.textures[nm])
  const why = fl.shader !== 'alpha' || flowMb[j].material ? '只做插畫切片'
    : names.some((nm, k) => !nm || !dims[k]?.file) ? 'pptr 表裡有匯出檔沒有的 sprite'
    : dims.some((d) => d.w !== dims[0].w || d.h !== dims[0].h) ? 'sprite 尺寸不一' : ''
  if (why) { warn(`${owner}（${S.names.length} 張）${why}，引擎不支援，照靜止畫`); return }
  const { w, h } = dims[0], cols = Math.max(1, Math.floor(4096 / w)), maxRows = Math.max(1, Math.floor(4096 / h))
  const nSheets = Math.ceil(names.length / (cols * maxRows)), rows = Math.ceil(Math.ceil(names.length / nSheets) / cols)
  const per = cols * rows, base = names[0].replace(/_?\d+$/, '')
  const sheets = Array.from({ length: nSheets }, (_, s) => `${base}_sheet${s}.webp`)
  const cell = new Map(names.map((nm, k) => [S.names.indexOf(nm), k]))
  const keys = [0, cell.get(idx[0]), ...S.keys.flatMap((k, n) => [num(k[0]), cell.get(idx[n + 1])])]
  sheets.forEach((nm, s) => sheetJobs.push({ nm, w, h, cols, rows, files: names.slice(s * per, (s + 1) * per).map((x) => join(srcDir, D.textures[x].file)) }))
  // 圖層改指圖集：原本那張 sprite 已拼進圖集，沒有別人用就不另外複製（10-30 補，戰部渡多出一張用不到的 _00000.png）
  const still = fl.tex
  fl.tex = sheets[0]
  if (!flows.some((x) => x.tex === still)) usedTex.delete(still)
  fl.seq = { sheets, cols, rows, len: num(S.len), keys }
  note(`${owner}：${names.length} 張拼成 ${nSheets} 張 WebP 圖集（${cols}×${rows} 格，${w}×${h}）`)
})

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
if (sheetJobs.length) {
  const sharp = (await import('sharp')).default
  for (const J of sheetJobs) {
    const composite = J.files.map((input, k) => ({ input, left: (k % J.cols) * J.w, top: Math.floor(k / J.cols) * J.h }))
    await sharp({ create: { width: J.cols * J.w, height: J.rows * J.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(composite).webp({ quality: 75, effort: 6 }).toFile(join(texDir, J.nm))
  }
}
console.log(`✅ 寫入 src/data/gachaFx/${isPilot ? 'pilots/' : ''}${wap}.json，貼圖 ${usedTex.size - missing.length} 張 → public/images/game/fx/`)
