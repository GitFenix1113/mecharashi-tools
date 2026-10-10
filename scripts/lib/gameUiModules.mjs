/**
 * 介面美術（活動、招募、大廳、劇情背景…）的分類規則——比對（diff-game-dump）與封存（import-game-assets --ui）共用。
 *
 * 結構照官方：客戶端的資源路徑本身就分好模組了，例如
 *   assets/gameproject/runtimeassets/ui/uiimages/uiplotactivitydetectiveob25_abs/uiplotactivitydetectiveob25_atlas/xxx.png
 *   assets/gameproject/runtimeassets/ui/uiimages/uigacha/pilotob16_abs/xxx.png
 * 取 ui/uiimages/（或 ui/textimages/chinese/）之後的第一段當「模組」，其餘當子資料夾；
 * 去掉打包用的雜訊（_abs 字尾、<模組>_atlas／<模組>_noatlas 這一層），版本號（obNN）留著——那是之後對版本的線索。
 *
 * 封存落點：<site-archive>/game/ui/<用途>/<模組>/<子資料夾…>/<官方檔名>.webp
 * 用途（UI_GROUPS）是我們加的人話分類，寫在下面的字典裡；字典沒登記的模組放 _unsorted/，比對報告會列出來請人補字典。
 *
 * ⚠ 中文名是依官方模組名推測的（2026-10-11 依當時 96 個模組建檔），看到圖發現不對就直接改字典，
 *   下次 `import-game-assets.mjs --ui --apply` 會把檔案搬到新的用途資料夾。
 */

/** 用途 → 中文。`archive: false` 的不進封存（系統介面零件、簡中文字圖） */
export const UI_GROUPS = {
  gacha: { zh: '招募', archive: true },
  activity: { zh: '活動', archive: true },
  lobby: { zh: '大廳', archive: true },
  skin: { zh: '造型', archive: true },
  story: { zh: '劇情與地圖', archive: true },
  mode: { zh: '常駐玩法', archive: true },
  system: { zh: '系統介面', archive: false },
  entity: { zh: '實體圖（機師、圖示另有匯入模式）', archive: false },
  text: { zh: '簡中文字圖', archive: false },
  _unsorted: { zh: '未分類（字典沒登記）', archive: true },
}

// [模組名 或 前綴規則, 用途, 中文說明]；前綴規則寫成 RegExp，先比對完整名稱、再比對規則
const DICT = [
  // ── 招募 ──
  ['uigacha', 'gacha', '卡池主視覺（子夾 pilotobNN／mechaobNN＝第 NN 版的卡池）'],
  ['uipilotgacha', 'gacha', '機師招募介面'],
  ['uiwapgacha', 'gacha', '機甲招募介面（機甲卡）'],
  ['pilotgachaimg', 'gacha', '機師招募立繪（Img_1_pilot_gacha_<英文名>）'],
  ['uiactivityturntabledraw', 'gacha', '轉盤抽獎（造型獎池）'],
  // ── 活動 ──
  [/^uiplotactivity/, 'activity', '劇情活動（偵探系列等，模組名帶 obNN＝版本）'],
  ['uiactivity', 'activity', '活動通用（子夾 obNN＝版本）'],
  ['uioperationalactivity', 'activity', '營運活動'],
  ['uibattlepass', 'activity', '通行證'],
  ['uisignin', 'activity', '簽到'],
  ['uiscratchlottery', 'activity', '刮刮樂'],
  ['uicarnival', 'activity', '嘉年華'],
  ['uiraidactivity', 'activity', '突襲活動'],
  [/^uitargetedraid/, 'activity', '定向突襲'],
  ['uiraidscreen', 'activity', '活動關卡畫面（RaidScreen 編號）'],
  ['uicommanderbattle', 'activity', '指揮官對戰活動'],
  ['uiprotagonistpilotchallenge', 'activity', '主角機師挑戰'],
  // ── 大廳 ──
  ['uilobbymain', 'lobby', '大廳（含大廳角色立繪 Img_main_<名>）'],
  // ── 造型 ──
  ['uiskindisplay', 'skin', '造型展示'],
  ['uiskinreward', 'skin', '造型獎勵'],
  // ── 劇情與地圖 ──
  ['uidialogpic', 'story', '劇情對話插圖（子夾＝章節）'],
  ['uimappic', 'story', '地圖'],
  ['uimapscreenshot', 'story', '關卡截圖'],
  ['uiloading', 'story', '讀取畫面'],
  ['uiavg', 'story', '劇情演出介面'],
  ['uipilotsidestory', 'story', '機師支線故事'],
  ['uicutinfullscreengeneral', 'story', '全螢幕特寫演出'],
  // ── 常駐玩法 ──
  ['uipvp', 'mode', 'PVP'],
  ['uiroguelike', 'mode', '肉鴿玩法'],
  ['uiroguelikebg', 'mode', '肉鴿玩法背景'],
  ['uiraiddungeon', 'mode', '團隊副本'],
  ['uiraidlike', 'mode', '突襲'],
  ['uielitebattle', 'mode', '精英戰'],
  ['uiamphitheater', 'mode', '競技場'],
  ['uiwildarenapvp', 'mode', '荒野競技'],
  ['uicooptowerclimb', 'mode', '協力爬塔'],
  ['uidarkzonestrike', 'mode', '暗區突擊'],
  ['uisuicidesquad', 'mode', '敢死隊'],
  ['uicontinuoussimulationbattle', 'mode', '連續模擬戰'],
  ['uichipsdungeon', 'mode', '晶片副本（記憶風暴）'],
  ['uidungeon', 'mode', '副本'],
  ['uiunitedbattle', 'mode', '聯合作戰'],
  ['uicontingent', 'mode', '分遣隊'],
  ['uisuperfactory', 'mode', '超級工廠'],
  ['uisciamachy', 'mode', '模擬演習'],
  ['uiautochesspve', 'mode', '自走棋'],
  ['uistg', 'mode', '射擊小遊戲'],
  ['uigarrisonfront', 'mode', '駐防前線'],
  ['uiskynet', 'mode', '天網'],
  ['uiscoring', 'mode', '評分'],
  ['uimpl', 'mode', 'MPL 賽事'],
  ['uicommanderbattleduel', 'mode', '指揮官決鬥'],
  ['uitraininglevel', 'mode', '訓練關'],
  ['uirating', 'mode', '段位評級'],
  // ── 系統介面（不封存）──
  ['uicom', 'system', '共用介面'],
  ['uishop', 'system', '商店'],
  ['uinoviceguid', 'system', '新手引導'],
  ['uigarage', 'system', '機庫'],
  ['uibattle', 'system', '戰鬥介面'],
  ['uibattlemap', 'system', '戰鬥地圖'],
  ['uiworkshop', 'system', '工坊'],
  ['uipilot', 'system', '機師介面'],
  ['uipilotdevelop', 'system', '機師培養'],
  ['uirnd', 'system', '研發'],
  ['uiguild', 'system', '公會'],
  ['uineuralfitdrive', 'system', '神經驅動'],
  ['uioperationchip', 'system', '作戰晶片'],
  ['uiplayerinfo', 'system', '玩家資訊'],
  ['uihonormedal', 'system', '榮譽勳章'],
  ['uiitemenhance', 'system', '裝備強化'],
  ['uibioniccomputer', 'system', '仿生電腦'],
  ['uifriends', 'system', '好友'],
  ['uicrosshair', 'system', '準星'],
  ['uimechacore', 'system', '機甲核心'],
  ['uilogin', 'system', '登入'],
  ['uidialogimage', 'system', '對話框'],
  ['uiweaponexchange', 'system', '武器兌換'],
  ['uigameend', 'system', '結算'],
  ['uimail', 'system', '郵件'],
  ['uicutingeneral', 'system', '戰鬥 cut-in 零件'],
  ['uimodules', 'system', '模組介面'],
  ['uipilotpanel', 'system', '機師面板'],
  // ── 實體圖：已由 import-game-assets 的其他模式處理（core／extended／--icons／--equip-icons），不在這裡重複封存 ──
  ['uipiloticons', 'entity', '機師立繪、頭像、機師卡'],
  ['uiicons', 'entity', '技能／BUFF／武器／背包／道具圖示'],
]

const EXACT = new Map(DICT.filter(([k]) => typeof k === 'string').map(([k, g, zh]) => [k, { group: g, zh }]))
const RULES = DICT.filter(([k]) => k instanceof RegExp)

const UI_ROOT_RE = /runtimeassets\/ui\/(uiimages|textimages\/chinese)\/(.+)$/

/**
 * 官方資源路徑 → { module, sub, text }；不是 UI 圖（角色模型、場景…）回 null。
 * text＝住在 textimages/chinese/（簡中文字圖），預設歸「簡中文字圖」，字典另有登記的除外（pilotgachaimg）。
 */
export function uiLocation(assetPath) {
  const m = typeof assetPath === 'string' ? assetPath.match(UI_ROOT_RE) : null
  if (!m) return null
  const segs = m[2].split('/').slice(0, -1).map((s) => s.replace(/_abs$/, ''))
  if (!segs.length) return null
  const [module, ...rest] = segs
  const sub = rest.filter((s) => !/_(no)?atlas$/.test(s))
  return { module, sub, text: m[1] !== 'uiimages' }
}

/** 模組 → { group, zh, known }；字典沒登記的：文字圖歸 text，其餘歸 _unsorted */
export function uiModuleInfo(module, text = false) {
  const rule = RULES.find(([re]) => re.test(module))
  const hit = EXACT.get(module) ?? (rule && { group: rule[1], zh: rule[2] })
  if (hit) return { ...hit, known: true }
  return { group: text ? 'text' : '_unsorted', zh: '', known: false }
}

/**
 * 是不是值得留的「美術圖」，而不是按鈕、遮罩、特效、圖集整張。
 * _Raw（官方給大圖的字尾）、長邊 ≥ 512、或檔名帶 banner 的才算。
 */
export function isUiArt(row) {
  const n = row.name
  if (/^(Btn_|FX_|T_UIFX|sactx-)/.test(n) || /(mask|shadow)/i.test(n)) return false
  return /_Raw$/.test(n) || Math.max(row.width, row.height) >= 512 || /banner/i.test(n)
}

/** 擷取的一列 → 封存的相對路徑（不含副檔名）；不封存的回 null */
export function uiArchivePath(row) {
  const loc = uiLocation(row.asset_path)
  if (!loc || !isUiArt(row)) return null
  const info = uiModuleInfo(loc.module, loc.text)
  if (!UI_GROUPS[info.group].archive) return null
  return ['ui', info.group, loc.module, ...loc.sub, row.name].join('/')
}
