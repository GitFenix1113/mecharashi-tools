// 劇情故事館的靜態資料型別。資料由 scripts/import-story.mjs 從台版遊戲參數產生，放在 src/data/story/：
//
//   index.json            目錄（每本的名稱、關數、行數；館首頁只讀這份）
//   main/<章節 ID>.json    主線一章        → 書 ID main-<章節 ID>
//   event/<活動 ID>.json   一個活動的劇情   → 書 ID event-<活動 ID>
//   memory/<群組 ID>.json  一位機師的回憶   → 書 ID memory-<群組 ID>
//
// ID 都是遊戲設定表的 ID：改版重跑腳本時不會變，分享出去的網址也就不會壞。

export type StoryKind = 'main' | 'event' | 'memory'

/**
 * 一行對白：[說話者, 文字] 或 [說話者, 文字, 選項]。說話者空字串＝旁白。
 * 文字只會帶兩種標記：<y>強調</y>、<c=#rrggbb>上色</c>（storyText.ts 解析，不走 innerHTML）。
 */
export type StoryLine = [speaker: string, text: string] | [speaker: string, text: string, choices: string[]]

/**
 * 場景條的一格（PLAN-042-J）：[行索引, 場景 key]——在 lines[行索引] 前插一張遊戲本身的對白背景。
 * key 是官方檔名（例 P001_Raw），圖在 /images/game/story/<key>.webp（storyScenes.ts）。
 * 行索引含戰中的 null 分隔，但一定指到真的對白行；同一段裡嚴格遞增、相鄰兩格不會是同一張（匯入時就收斂好了）。
 */
export type StoryShot = [line: number, key: string]

/** 一關裡的一段：開場過場／戰鬥中／結尾過場。戰中的 null 是兩個觸發之間的分隔 */
export interface StoryPart {
  at: 'start' | 'battle' | 'end'
  lines: (StoryLine | null)[]
  /** 換場景的點；整段都沒有可用的背景圖時不給 */
  shots?: StoryShot[]
}

export interface StoryStage {
  /** 頁內錨點，也是 React key（w＝主線節點、l＝活動關卡、m＝機師回憶關卡，後面接設定 ID） */
  key: string
  /** 關卡編號：主線「2-1」、活動與回憶「1」；遭遇戰之類的小關沒有 */
  code: string
  name: string
  /** 地點（主線的 PosStrKey、部分活動的關卡名稱欄） */
  place?: string
  /** 關卡簡介 */
  desc?: string
  /** 主線支線 */
  branch?: true
  /** 活動裡的分幕（只有一幕時不給） */
  group?: string
  parts: StoryPart[]
}

/** 去重後「其餘關卡在別本」的註記 */
export interface StoryCrossRef {
  id: string
  stages: number
}

export interface StoryBook {
  id: string
  kind: StoryKind
  /** 主線是「Chapter-II」；活動與回憶是種類名 */
  title: string
  name: string
  desc?: string
  /** 機師回憶：機師卡編號（＝pilots.gameId） */
  gameId?: string
  /** 整個活動被這本吸收：曾以這些活動名推出 */
  aka?: string[]
  /** 這本只收了活動多出來的關，其餘在這些書裡 */
  seeAlso?: StoryCrossRef[]
  /** 反向：活動版多出來的關在這些書裡 */
  extra?: StoryCrossRef[]
  /** 主線：該章區域的世界地圖（官方檔名，例 Bg_map_LocstaDesert_03_Raw），戰鬥段落拿來當底（PLAN-042-J） */
  map?: string
  /** 主線：區域名稱（帕黎爾沙漠），戰場地圖的圖說 */
  region?: string
  stages: StoryStage[]
}

export interface StoryCatalogEntry {
  id: string
  kind: StoryKind
  title: string
  name: string
  desc?: string
  gameId?: string
  aka?: string[]
  stages: number
  lines: number
}

export interface StoryCatalog {
  /** 資料來源的客戶端版本（BuildNum／BuildTime） */
  source: { build: string; buildTime: string }
  books: StoryCatalogEntry[]
}
