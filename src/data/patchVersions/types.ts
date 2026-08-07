export interface ArmamentRaid {
  name: string
  weapons?: string[]
  weaponPilots?: string[]  // parallel to weapons[], index-aligned exclusive pilot names
  backpacks?: string[]
}

export interface BattlePass {
  pilots?: string[]
  mechs?: string[]
}

export type ActivityType =
  | 'skinGacha'           // 角雕刮刮樂
  | 'roulette'            // 角雕輪盤
  | 'pilotMission'        // 角雕特遣（含複數機師）
  | 'crossShipping'       // 跨域海運（含複數機甲）
  | 'specificPilotBanner' // 特定角色池
  | 'specificMechBanner'  // 特定機甲池
  | 'limitedEvent'        // 限時活動
  | 'loginEvent'          // 限時簽到活動
  | 'battlePass'          // 版本戰令

export interface TimedActivity {
  name: string          // 活動名稱，如「角雕刮刮樂」
  startDate: string     // 起始日 YYYY/MM/DD，固定為星期四
  weeks: number         // 持續週數（1 = 當週四到下週三）
  type: ActivityType
  pilots?: string[]     // pilotMission 時的機師列表
  mechs?: string[]      // crossShipping 時的機甲列表
}

export interface PatchHalf {
  cnDate: string
  twDate?: string
  twIsPredicted?: boolean
  pilots?: string[]
  mechs?: string[]
  pilotSelection?: string[]
  mechSelection?: string[]
  armamentRaids?: ArmamentRaid[]
  battlePass?: BattlePass
  // 甘特圖活動（陸服 / 台服各自維護）
  cnActivities?: TimedActivity[]
  twActivities?: TimedActivity[]
  // 舊欄位保留，cnActivities/twActivities 優先；無新欄位時 fallback 顯示
  /** @deprecated 請改用 cnActivities / twActivities */
  skinGacha?: string
  /** @deprecated 請改用 cnActivities / twActivities */
  rouletteEvent?: boolean
  /** @deprecated 請改用 cnActivities / twActivities */
  specialEvents?: string[]
  /** @deprecated 請改用 cnActivities / twActivities */
  revivedBanners?: string[]
}

export interface GrayOpsUpdate {
  company: '武裝工坊' | '創新動力' | 'GeekX' | '火花塞'
  newMechs: string[]
}

export type GrayOpsCompany = '武裝工坊' | '創新動力' | 'GeekX' | '火花塞'

export interface VersionIconUrls {
  pilots?: Record<string, string>
  mechs?: Record<string, string>
  weapons?: Record<string, string>
  backpacks?: Record<string, string>
}

/**
 * 名稱 → Firestore 文件 ID。首頁版本濃縮表靠它把圖示接上引用浮窗（EntityRefView）。
 *
 * 為什麼要存而不是前台推導：三個集合的文件 ID 都帶建檔當下的流水號
 * （`pilot_001_亞瑟` / `mech_001_伊格尼特` / `weapon_003_xxx`），從名稱推不回來。
 * 由後台「自動同步」在既有的那趟 getDocs 裡順手記下，前台零額外讀取。
 *
 * 為什麼與 iconUrls 分成兩張表而不是合併成 { id, icon }：兩者**填入時機不同**。
 * 武器常常是資料先建檔、圖片素材晚幾天才處理好；分開存，同步時才能各自「只補空缺」，
 * 前台也才能做到「有 ID 就可點，有沒有圖是另一回事」。
 *
 * 值的格式：一般是純文件 ID；跨集合的條目（backpacks 列的複合武器）記成
 * `weapon:<docId>`。解析與寫入一律走 entityRef.ts 的 parse/formatEntityIdValue。
 */
export interface VersionEntityIds {
  pilots?: Record<string, string>
  mechs?: Record<string, string>
  weapons?: Record<string, string>
  backpacks?: Record<string, string>
}

export interface PatchVersion {
  version: string
  name?: string
  bannerImage?: string
  upper: PatchHalf
  lower: PatchHalf
  crisisShop?: string[]
  memoryStorm?: string
  borderShop?: string
  arenaShop?: string
  grayOpsUpdates?: GrayOpsUpdate[]
  notes?: string
  isTwCurrent?: boolean
  iconUrls?: VersionIconUrls
  entityIds?: VersionEntityIds
}
