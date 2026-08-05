// ─── 背包 ──────────────────────────────────────────────────────────────────

/**
 * 背包的製作前置關係（PLAN-036）。前置主背包一律是「低一階」的背包：
 *   · SS 特種背包 ← S+ 前置主背包（無法從名字 derive，後台手輸；如 征服者背包 ← 某 S+）
 *   · S+ 複合背包 ← S 變體背包（可從名字 derive，腳本填；
 *       如 出力強化背包·首攻 ＝ 出力背包(S) + 強化背包·首攻(S)，存變體背包「強化背包·首攻」）
 * 只存前置主背包這一個 id；種類/線/變體皆由此 id 查 backpacks 表 derive。
 *
 * · 圖紙 ＝ derive（name + '設計圖'），材料來源（武裝討伐）為未來擴充點，不存。
 * · S+ 的另一材料「功能背包」（出力背包）可由 base derive，不存；任意 3 個 S ＝萬用，不存。
 * · 形態二（特種背包武器，如裁決者）產物是武器，已由 PLAN-031 weapon.upgrade 涵蓋，不在此。
 */
export interface BackpackCraft {
  /** 前置主背包 doc id（低一階背包；SS←S+ 手輸、S+←S 名稱可推）。 */
  prereqBackpackId: string
}

export interface Backpack {
  id: string
  name: string
  /** 背包圖示 URL · https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo/pack/Icon_backpack_{ID}.png */
  icon?: string
  type: string            // BackpackType：'Heal' | 'Ammo' | 'Interference' | 'Invisible' | 'BackupEquipment' | 'MovePointAdd' | 'Flow'
  rarity: string          // WeaponRarity（與武器共用）：'SS' | 'S+' | 'S' | 'A' | 'B' · API quality: SSSR→SS / UR→S+ / SSR→S / SR→A / R→B
  weight: number          // 重量（佔機甲出力）· API: weight
  slot: string                // WeaponEquipSlot：固定為 'back'（WeaponEquipSlot.BACK）；與武器共用 enum 供裝備計算器統一判斷部位
  assemblableArmorType: string[]  // AssemblableArmorType 陣列（正向邏輯）：[] = 無限制；['Light'] / ['Medium'] / ['Heavy'] / 複數 = 指定機甲類型 · API: AssemblableAirmenType
  repairAmount: number    // 修理量；非修理類背包填 0 · API: AmountOfRepair
  /** SS 特種背包製作關係（PLAN-036）；僅 SS 且後台已輸入者有值。無值＝未關聯，前台優雅降級。 */
  craft?: BackpackCraft
  /**
   * 遊戲內背包卡下方的灰字風味文案（PLAN-043）。
   * 例：移動背包 →「直接將額外動能輸送到腿部傳動裝置，無論是使用滑輪還是步行，機甲的移動力都能得到提升。」
   *
   * 屬於**背包**而非技能：換背包掛同一個技能時這段不會跟著走。官方 WIKI 未錄入，純人工維護。
   */
  flavor?: string
  /**
   * 掛載的背包技能 doc id（PLAN-043）。元素格式同 buffIds，可含 `id@N` 指定等級
   * （如 `bpskill_移動強化@1` ＝ 移動強化Ⅰ）。
   *
   * 用陣列而非單一 skillId：目前實務長度恆為 0 或 1，但改陣列的成本只是渲染側多一層 map，
   * 而若日後出現雙技能背包，單一欄位就得再走一次型別遷移 + 腳本 flip。
   */
  skillIds: string[]
}
