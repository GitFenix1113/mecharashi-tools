# public/images/game — 官方原檔（PLAN-054）

遊戲客戶端擷取的原始圖檔，轉成 WebP（q82、原尺寸、保留透明）後以**官方檔名逐字**放進 **遊戲 ID 資料夾**。
圖片的主鍵是遊戲 ID，不是站上的中文名——名字會漂，ID 不會。

```
pilots/<gameId>/      gameId ＝ 機師卡 Icon_item_<gameId>A 的編號（DB: pilots.gameId）
  <artKey>_half.webp    340²         頭像
  <artKey>_head.webp    90²          頭部特寫（構圖與 half 不同）
  <artKey>_Raw.webp     1240×1080    半身
  Icon_item_<gameId>A.webp  340²     機師卡
mechs/<wap>/          wap ＝ 機甲四碼編號（DB: mechs.gameId）
  Icon_mecha_wap<wap>.webp          560×340     立繪
  Icon_wap<wap>_1~4.webp            340²        部件：軀幹／左臂／右臂／腿
  Icon_mecha_wap<wap>_SN_Raw.webp   2000×1080   全身大圖
icons/                圖示圖庫（PLAN-055／056）：扁平、一張圖一份、官方檔名就是 key
  skill/  buff/       技能類、BUFF 字形
  weapon/             Icon_weapon_<gameId>.webp    340²（DB: weapons.gameId、sideGameIds）
  backpack/           Icon_backpack_<gameId>.webp  340²（DB: backpacks.gameId；2 個官方檔名是 Icon_BackPack_）
  index.json  features.bin   選圖器索引與以圖搜圖特徵（build 產生）
```

- **武器／背包的 gameId 是外觀編號**（PLAN-056）：EX／·改 與本體共用，不是武器身分。讀取端走 `weaponIconCandidates()`／`backpackIconCandidates()`（`src/utils/gameIcons.ts`）。
  官方圖庫刻意**全收**（含 400x 敵方 BOSS 裝備、9 開頭機甲綁定肩部、`_b` 外型變化）——圖示是抽象的道具圖，不算洩漏未上線內容（同 PLAN-055 決策三）。
  站長編輯過的非官方圖不放這裡，放 `public/images/weapons/`，檔名不以 `Icon_` 開頭。

- **gameId 與 artKey 不互推**（DB: `pilots.artKey`）：維娜的資料夾是 `10103144`、檔名是 `Pilot_13019A_*`，共 5 位例外，見 `src/types/pilot.ts`。
- 讀取端一律走 `pilotGameArt()`／`mechGameArt()`（`src/utils/gameArt.ts`），不要自己拼路徑；有沒有某種圖由 build 產生的 `src/data/gameArtIndex.ts` 決定。
- 這裡只放**讀取端會用到的種類（core）**。造型、招募立繪、大廳場景等 extended 素材與站上沒有的實體（_reserve）**不進 repo**——repo 是公開的，進來就等於公開還沒上線的內容。

## 匯入與重跑

```bash
node scripts/import-game-assets.mjs                                          # v3 整批（dry-run）
node scripts/import-game-assets.mjs --apply                                  # 寫入
node scripts/import-game-assets.mjs --id=<gameId> --art-key=<artKey> --apply # 新機師
node scripts/import-game-assets.mjs --wap=<####> --apply                     # 新機甲
node scripts/import-game-assets.mjs --equip-icons --apply                    # 武器／背包圖示（整夾；新擷取只補新的）
node scripts/generate-art-index.mjs                                          # 重產索引（build／predev 也會跑）
node scripts/check-image-refs.mjs                                            # 掃描 DB 與程式碼裡的圖片路徑
```

原始擷取（PNG、圖片索引、擷取工具）在本機、不進 repo；命名規則在 `scripts/lib/gameAssetKinds.mjs`。
