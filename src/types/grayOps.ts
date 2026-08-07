// ─── 灰燼行動名單 ──────────────────────────────────────────────────────────────

/**
 * 灰燼行動名單的一台機甲。
 *
 * `icon` / `mechId` 是**後台同步時寫死的快照**，不是前台即時查出來的。理由與版本濃縮表
 * （patchVersions 的 iconUrls / entityIds）相同：首頁若為了取圖而載入整個 mechs 集合，
 * 就是為了幾十張縮圖付掉一整包讀取；存快照則前台零額外讀取，點開詳情時才由
 * EntityRefView 自己 ensureLoaded('mechs')。
 *
 * 兩個欄位刻意各自可缺席——灰燼行動名單本來就以「未來機甲」為主，尚未建檔（無 mechId）
 * 或已建檔但圖還沒處理好（無 icon）都是常態，顯示層對四種組合都要能退化。
 */
export interface GrayOpsMechEntry {
  name: string
  version?: string
  /** 機甲圖示路徑：本地 /images/... 或官方 CDN 絕對網址 */
  icon?: string
  /** mechs 集合的文件 ID；有值才能點開引用浮窗 */
  mechId?: string
}

export interface GrayOpsRoster {
  companies: Record<string, GrayOpsMechEntry[]>
}
