// ⚠ 本檔由 scripts/generate-art-index.mjs 自動產生，請勿手動編輯。
// 重新產生：node scripts/generate-art-index.mjs（build / predev 會自動跑）

/**
 * 有站上原稿全身立繪（`/images/pilots/<gameId>/art.webp`）的機師資料夾名＝遊戲 ID（PLAN-054 D-2 起）。
 *
 * 用途：`art.webp` 是直式全身（863×1600），既有的 `full.webp` 是橫式半身特寫
 * （1240×1080），兩者構圖不同、共用不了同一個框。版面要在**渲染前**就知道
 * 該用哪一套構圖，而不是等圖載完才知道 —— 後者會讓卡片在載入完成那一刻跳動。
 *
 * ⚠ 這裡存的是**圖片資料夾名**——PLAN-054 D-2 起一律是遊戲 ID（沒有 gameId 的才退回 `portrait` 路徑那一段）。
 *   查詢一律走 `hasPilotArt(pilot)`（內部用 `pilotArtDir()`），不要自己用名字去比對。
 *
 */
export const PILOT_ART_INDEX: ReadonlySet<string> = new Set([
  '10102102',
  '10103101',
  '10103105',
  '10103106',
  '10103107',
  '10103109',
  '10103110',
  '10103112',
  '10103113',
  '10103115',
  '10103118',
  '10103119',
  '10103120',
  '10103121',
  '10103122',
  '10103123',
  '10103124',
  '10103126',
  '10103127',
  '10103130',
  '10103131',
  '10103133',
  '10103134',
  '10103135',
  '10103136',
  '10103137',
  '10103138',
  '10103139',
  '10103140',
  '10103141',
  '10103145',
  '10103146',
  '10103149',
  '10103150',
  '10103151',
  '10103152',
  '10103153',
  '10103154',
  '10103155',
  '10103157',
  '10103158',
  '10103161',
  '10103162',
  '10103164',
  '10103165',
  '10103166',
  '10103168',
  '10103171',
  '10103172',
  '10103174',
  '10103179',
  '10103180',
])

/**
 * 有官方**去背原稿**（`/images/mechs/<名>/art.webp`，1600×864 透明底）的機甲資料夾名。
 *
 * 用途與機師那份相同，但判準不是構圖而是**撐不撐得起放大出血的版面**：
 *   · `art.webp`      1600×864 ⇒ 放到 421 高是縮小，銳利，可以出血
 *   · `portrait.webp`  560×340  ⇒ 同樣尺寸要放大 1.24 倍，糊；只能走小尺寸版面
 * 匯出圖的主視覺因此要**在渲染前**就分流，不能靠 `imageCandidates()` 逐層退回
 * （那只答得出「載到了沒」，答不出「載到的是哪一種」）。
 *
 * ⚠ 兩者**都是去背圖**（實測 88/88，portrait 的透明像素佔 10–36%）。
 *
 * ⚠ 存的是**圖片資料夾名**（`mech.portrait` 路徑裡的那一段），不一定等於 `mech.name`。
 *   查詢一律走 `hasMechArt(mech)`。
 */
export const MECH_ART_INDEX: ReadonlySet<string> = new Set([

])

/** 官網 hero 圖層的尺寸：color／line 共用一個 bbox（w×h），name 是名字層自己的 bbox。 */
export interface OfficialArtGeometry { w: number; h: number; nameW: number; nameH: number }

/**
 * 有官網 hero 圖層（`/images/pilots/<名>/official-{color,line,name}.webp`）的機師資料夾名
 * （PLAN-042-C C-1）。官網只做了 8 位；其餘機師走濾鏡線稿。
 *
 * ⚠ 存的是**圖片資料夾名**，查詢一律走 `hasOfficialArt(pilot)` / `pilotOfficialArt(pilot)`。
 */
export const PILOT_OFFICIAL_INDEX: ReadonlyMap<string, OfficialArtGeometry> = new Map([
  ['10103101', { w: 732, h: 788, nameW: 682, nameH: 759 }],
  ['10103102', { w: 602, h: 777, nameW: 692, nameH: 759 }],
  ['10103107', { w: 611, h: 810, nameW: 727, nameH: 759 }],
  ['10103110', { w: 538, h: 776, nameW: 654, nameH: 759 }],
  ['10103111', { w: 1085, h: 828, nameW: 683, nameH: 759 }],
  ['10103112', { w: 718, h: 777, nameW: 689, nameH: 759 }],
  ['10103113', { w: 1019, h: 773, nameW: 666, nameH: 759 }],
  ['10103123', { w: 943, h: 800, nameW: 653, nameH: 847 }],
])
