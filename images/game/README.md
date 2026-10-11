# public/images/game — 官方原檔（PLAN-054）

遊戲客戶端擷取的原始圖檔，轉成 WebP（q82、原尺寸、保留透明）後以**官方檔名逐字**放進 **遊戲 ID 資料夾**。
圖片的主鍵是遊戲 ID，不是站上的中文名——名字會漂，ID 不會。

```
pilots/<gameId>/      gameId ＝ 機師卡 Icon_item_<gameId>A 的編號（DB: pilots.gameId）
  <artKey>_half.webp    340²         頭像
  <artKey>_head.webp    90²          頭部特寫（構圖與 half 不同）
  <artKey>_Raw.webp     1240×1080    半身
  Icon_item_<gameId>A.webp  340²     機師卡
npc/<號碼>/           NPC 圖庫（2026-10-12）：還沒對應到可抽機師的官方立繪——劇情 NPC、尚未上線的新角色
  <artKey>_half／_head／_Raw.webp   同機師三種、沒有機師卡；一個號碼可有 A／B 多套（DB: pilots.artKey 指過來）
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

- **技能類與 BUFF 圖示**（PLAN-055）：DB 只存官方檔名 key（`Icon_skill_passive_5004`，不帶路徑與副檔名），讀取端走
  `gameIconCandidates()`（`src/utils/gameIcons.ts`）拿檔名來這裡找。檔名文法 `Icon_skill_<種類>_<色系><批次><流水>`：
  種類＝外框形狀（main／order／passive／talent／pp），首位數＝色系（歸納、非官方定義，只當篩選器用）。
  BUFF 是白色字形（減益另有帶斜線的 `Icon_debuff_*`），由 `BuffGlyph` 疊色塊底，底色不在圖裡。
  舊編號＝現行圖的 172 個走別名表 `src/data/gameIconAliases.ts`（不另存檔）；擷取沒有、站上原有的 82 個標 legacy
  （`scripts/lib/gameIconMeta.json`）。兩份都由 `--icons --apply` 產生、只增不減，勿手改。
  舊的分用途資料夾（`images/skills/`、`modules/` 等）已於 PLAN-055 E-1 刪除。
- **武器／背包的 gameId 是外觀編號**（PLAN-056）：EX／·改 與本體共用，不是武器身分。讀取端走 `weaponIconCandidates()`／`backpackIconCandidates()`（`src/utils/gameIcons.ts`）。
  官方圖庫刻意**全收**（含 400x 敵方 BOSS 裝備、9 開頭機甲綁定肩部、`_b` 外型變化）——圖示是抽象的道具圖，不算洩漏未上線內容（同 PLAN-055 決策三）。
  站長編輯過的非官方圖不放這裡，放 `public/images/weapons/`，檔名不以 `Icon_` 開頭。

- **gameId 與 artKey 不互推**（DB: `pilots.artKey`）：維娜的資料夾是 `10103144`、檔名是 `Pilot_13019A_*`，共 5 位例外，見 `src/types/pilot.ts`。
- 讀取端一律走 `pilotGameArt()`／`mechGameArt()`（`src/utils/gameArt.ts`），不要自己拼路徑；有沒有某種圖由 build 產生的 `src/data/gameArtIndex.ts` 決定。
- **NPC 圖庫**（`npc/`，2026-10-12）：NPC 轉正的機師官方常沿用 NPC 時期那張立繪。`pilotGameArt()` 在 gameId 資料夾找不到時改以
  `artKey` 查這裡，所以管理員在後台「選取官方立繪」的 NPC 分組點一下就有圖，不必等機師卡、也不必等站長匯入。
  可抽機師（`pilots/` 裡的立繪號碼，連同他們的外觀）不收；轉正後用 `--id` 匯入 core，這裡那份留著（DB 的 portrait 可能還指著它），選圖器自動去重。
  ⚠ 號碼不同的「可抽機師另一造型」排除不掉（瑪阿特劇情換造型前、貝爾莎左右翻轉版、海莉絲、卡蜜拉早期）：人工登記在
  `scripts/lib/npcArtNotes.json`（owner＝機師文件 ID），選圖器掛在他名下、不算未使用。英文名由 `--npc --apply` 從 3D 模型資料夾抓進
  `scripts/lib/npcArtMeta.json`，選圖器可用英文搜尋——新機師公布英文名時找 NPC 時期立繪最快的方法。
  站長 2026-10-12 決定上站（取代 10-04「NPC 不進 repo」）：查資料的人不怕劇透，官方之後還會有好幾位 NPC 轉正。
- 這裡只放**讀取端會用到的種類（core）＋NPC 圖庫**。造型、招募立繪、大廳場景等 extended 素材、敵方機甲等其餘 _reserve，
  以及站上用不到的其他圖示（道具、勳章、肉鴿…）**不進 repo**，在 repo 外的封存夾（`E:/Mecharashi_Data/site-archive/game/`）。

## 遊戲改版後的歸檔流程（照做就好，不需要 AI）

每一步都是複製貼上；要動腦的只有「誰是誰」，那是站長／管理者的判斷。

1. **擷取**：跑擷取工具，結果會在 `E:/Mecharashi_Data/一般圖片_<版本碼>/`。
2. **差異報告**：`node scripts/diff-game-dump.mjs`，打開它印出的 `_local-notes/<月>/<日>_遊戲擷取差異.html`。
3. **照「下一步」逐條做**。每一步標 ✅ 已完成／⬜ 待做，附可以直接貼的指令：
   先**不加** `--apply` 跑一次（dry-run，只報告、不寫任何東西），沒問題再加 `--apply` 重跑。
   - 「上站」的步驟寫進這個資料夾（之後要 commit）：新機師卡、新機甲、NPC 立繪、技能／BUFF／武器／背包圖示
   - 「封存」的步驟寫到 repo 外的 `E:/Mecharashi_Data/site-archive/game/`（不必 commit、不部署）：
     介面美術（`ui/`）、其他圖示（`icons/`）、既有機師的新造型（`pilots/<gameId>/`）
   - 只有新機師要人判斷：`--art-key` 填哪張立繪（gameId 與 artKey 不互推）。新機甲只放圖、不碰資料庫。
4. **重跑差異報告**：每一步都應該是 ✅。報告是產生當下的快照，做完幾步就重跑一次。
5. **收尾**（上站的步驟有做才需要；報告最後也有同一份清單）：
   1. `npm run dev`，確認後台看得到新圖（「選取官方立繪」的「未使用」、圖示選圖器的「最新」）。dev／build 會自動重產索引。
   2. `git status` 確認變動只在 `public/images/game/`、`src/data/`、`scripts/lib/` → `git add -A` →
      `git commit -m "chore(images): <日期> 擷取的官方原檔匯入"`（chore 不必寫網站更新履歷）。
   3. `npm run push`（會先 build，失敗就不會推上去）。
   4. 等 GitHub Actions 的 `pages-build-deployment` 跑完。部署完成前若有人開過新圖的網址，Cloudflare 會把 404 快取住 →
      到 Cloudflare 清快取（報告最後有網址清單）。
   5. 管理者在後台把新機甲／新機師連上官方原檔：「選取官方立繪」裡新匯入的就在「未使用」。站上還沒有的新機甲先建檔再選。

**什麼時候才需要找人改程式**：報告出現「⚠ 要人處理」（字典沒登記的新模組——不處理也已經封存在 `ui/_unsorted/`）、
匯入時「守門命中、中止」（同名但內容不同、大小寫撞名），或官方改了命名規則。

## 匯入指令一覽

新擷取用 `--src=latest`；不給 `--src` 時讀第一次擷取 `Data`（v3 整批只能用它）。

```bash
node scripts/import-game-assets.mjs                                          # v3 整批（dry-run）
node scripts/import-game-assets.mjs --apply                                  # 寫入
node scripts/import-game-assets.mjs --id=<gameId> --art-key=<artKey> --apply # 新機師
node scripts/import-game-assets.mjs --wap=<####> --apply                     # 新機甲
node scripts/import-game-assets.mjs --src=latest --npc --apply               # NPC 圖庫（只補新的；第一次先 --src=Data）
node scripts/import-game-assets.mjs --src=latest --icons --apply             # 技能類／BUFF 圖示（只補新 key；別名與 legacy 只增不減）
node scripts/import-game-assets.mjs --equip-icons --apply                    # 武器／背包圖示（整夾；新擷取只補新的）
node scripts/import-game-assets.mjs --src=latest --ui --apply                # 活動／招募／大廳等介面美術 → repo 外封存夾（不部署）
node scripts/import-game-assets.mjs --src=latest --other-icons --apply       # 其他圖示（道具、勳章、肉鴿、車輛、塗裝小圖…）→ repo 外封存夾
node scripts/import-game-assets.mjs --src=latest --skins --apply             # 既有機師的新造型 → repo 外封存夾 pilots/<gameId>/
node scripts/import-game-assets.mjs --promote=<ui/ 底下的路徑> --apply        # 封存夾挑好的 → 這裡的 ui/（上架＝公開，只挑台版已上線的）
node scripts/generate-art-index.mjs                                          # 重產索引（build／predev 也會跑）
node scripts/check-image-refs.mjs                                            # 掃描 DB 與程式碼裡的圖片路徑
```

新圖示要等 `pages-build-deployment` 發布完成才可以請求（含驗證用的 curl），否則 Cloudflare 會把 404 快取住、要 Purge。
圖示的完整流程（指定給資料、留空原則、BUFF 底色）見 `.claude/skills/data-patch/SKILL.md`。

原始擷取（PNG、圖片索引、擷取工具）在本機、不進 repo；命名規則在 `scripts/lib/gameAssetKinds.mjs`（圖示：`gameIconKinds.mjs`）。
