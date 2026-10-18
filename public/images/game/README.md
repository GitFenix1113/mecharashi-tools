# public/images/game — 官方原檔（PLAN-054）

遊戲客戶端擷取的原始圖檔，轉成 WebP（q82、原尺寸、保留透明）後以**官方檔名逐字**放進 **遊戲 ID 資料夾**。
圖片的主鍵是遊戲 ID，不是站上的中文名——名字會漂，ID 不會。

```
pilots/<gameId>/      gameId ＝ 機師卡 Icon_item_<gameId>A 的編號（DB: pilots.gameId）
  <artKey>_half.webp    340²         頭像
  <artKey>_head.webp    90²          頭部特寫（構圖與 half 不同）
  <artKey>_Raw.webp     1240×1080    半身
  Icon_item_<gameId>A.webp  340²     機師卡
  skins/<立繪鍵>_{Raw,half,head}.webp  造型（外觀，PLAN-042-D）：故事館的外觀切換讀這裡；索引 GAME_PILOT_SKINS
  skins/<立繪鍵>_Raw_view.webp        場景外觀的鑑賞版（衍生檔、不是官方檔名）：官方暈邊收窄，故事館「全身立繪」用；匯入時自動產
npc/<號碼>/           NPC 圖庫（2026-10-12）：還沒對應到可抽機師的官方立繪——劇情 NPC、尚未上線的新角色
  <artKey>_half／_head／_Raw.webp   同機師三種、沒有機師卡；一個號碼可有 A／B 多套（DB: pilots.artKey 指過來）
mechs/<wap>/          wap ＝ 機甲四碼編號（DB: mechs.gameId）
  Icon_mecha_wap<wap>.webp          560×340     立繪
  Icon_wap<wap>_1~4.webp            340²        部件：軀幹／左臂／右臂／腿
  Icon_mecha_wap<wap>_SN_Raw.webp   2000×1080   全身大圖
  skins/Img_Skin_wap<wap>_<代碼>.webp        1600×1500  塗裝（PLAN-042-B F-1）：故事館的塗裝切換讀這裡；索引 GAME_MECH_SKINS
  skins/Img_Skin_wap<wap>_<代碼>_thumb.webp  96²        塗裝列的縮圖（衍生檔：裁掉透明邊取中段）；匯入時自動產
  skins/Img_Skin_wap<兵裝號>.webp            1600×1500  兵裝組件（換整套模型的商城外觀，例：遊騎兵 3032 的龍膽＝wap3132）：保留官方檔名、放在本體資料夾
  card/mechcard_illustration_<卡池鍵>.webp   2600×1080  招募插畫（F-2，衍生檔：兩片 1024² 切片拼回卡池比例）；索引 GAME_MECH_CARDS
makers/               廠商舞台（PLAN-042-B F-2）
  Skynet_Wap_BG_<key>_Raw.webp      2048×1024   遊戲內機甲圖鑑的背景；<key>＝mechMakers 的文件 ID；索引 GAME_MAKER_STAGES
icons/                圖示圖庫（PLAN-055／056）：扁平、一張圖一份、官方檔名就是 key
  skill/  buff/       技能類、BUFF 字形
  weapon/             Icon_weapon_<gameId>.webp    340²（DB: weapons.gameId、sideGameIds）
  backpack/           Icon_backpack_<gameId>.webp  340²（DB: backpacks.gameId；2 個官方檔名是 Icon_BackPack_）
  class/              Icon_pilotclass_<3 碼>_<l|s>.webp   機師職業（PLAN-059；不進 DB，對照寫在 src/data/pilotClasses.ts）
  license/            Icon_wanzertype_<3 碼>_<l|s>.webp   駕照＝機甲類型（PLAN-059；對照寫在 src/data/mechWeightClasses.ts）
  camp/               Icon_logo_<4 碼>_<00|01>.webp       陣營徽章（PLAN-059；DB: pilotLore.factionLogos）
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
- **職業／駕照圖示、陣營徽章**（PLAN-059）：職業與駕照是白色字形，前台用 CSS mask 吃文字色（站上職業色、故事館墨色），
  所以存白色原圖就好。職業 007～012 是官方備案（011／012 是海莉絲的先鋒／虛粒子形態），也收。
  陣營徽章只收客戶端 `camptype` 資料夾；`factory`（機甲廠商）有同檔名、**不同圖**的 `Icon_logo_0024～0027`，不收、別混用。
  NVIDIA 聯動的兩張（`0028_01`、`0032_01`）站長決定不收。
  **新職業或新駕照上線時**：`--emblems` 只負責把圖放進來，`src/data/pilotClasses.ts`／`mechWeightClasses.ts` 的對照要人補（哪個編號是哪個職業）。

- **gameId 與 artKey 不互推**（DB: `pilots.artKey`）：維娜的資料夾是 `10103144`、檔名是 `Pilot_13019A_*`，共 5 位例外，見 `src/types/pilot.ts`。
- 讀取端一律走 `pilotGameArt()`／`mechGameArt()`（`src/utils/gameArt.ts`），不要自己拼路徑；有沒有某種圖由 build 產生的 `src/data/gameArtIndex.ts` 決定。
- **NPC 圖庫**（`npc/`，2026-10-12）：NPC 轉正的機師官方常沿用 NPC 時期那張立繪。`pilotGameArt()` 在 gameId 資料夾找不到時改以
  `artKey` 查這裡，所以管理員在後台「選取官方立繪」的 NPC 分組點一下就有圖，不必等機師卡、也不必等站長匯入。
  可抽機師（`pilots/` 裡的立繪號碼，連同他們的外觀）不收；轉正後用 `--id` 匯入 core，這裡那份留著（DB 的 portrait 可能還指著它），選圖器自動去重。
  ⚠ 號碼不同的「可抽機師另一造型」排除不掉（瑪阿特劇情換造型前、貝爾莎左右翻轉版、海莉絲、卡蜜拉早期）：人工登記在
  `scripts/lib/npcArtNotes.json`（owner＝機師文件 ID），選圖器掛在他名下、不算未使用。英文名由 `--npc --apply` 從 3D 模型資料夾抓進
  `scripts/lib/npcArtMeta.json`，選圖器可用英文搜尋——新機師公布英文名時找 NPC 時期立繪最快的方法。
  站長 2026-10-12 決定上站（取代 10-04「NPC 不進 repo」）：查資料的人不怕劇透，官方之後還會有好幾位 NPC 轉正。
- **造型／外觀**（`pilots/<gameId>/skins/`，2026-10-13 PLAN-042-D）：站長決定造型必須上站（取代 10-12「不進 repo」）。
  放子資料夾是因為 core 資料夾「一個 ID 只放一種立繪主鍵」。歸屬預設看檔名號碼，對不上的（例：`Pilot_10103107B` 判給洛莎·審判）
  寫在 `scripts/lib/pilotSkinMeta.json` 的 owner。名稱、順序、台版還沒推出先藏（隱藏）在**後台 › 故事館編輯台 › 外觀**設定
  （PLAN-042-E，存在 pilotLore.skins，存檔就生效、不必部署），全部選填，不填顯示「外觀 N」。
  NPC 圖庫裡屬於某位機師、而且有外觀卡的（海莉絲 `10103132A`、瑪阿特 `10103129A`）build 時也會列進她們的外觀。
  帶背景的場景插畫（透明 < 25%）build 時自動判定，前台換構圖。
  場景外觀匯入時會多產一張 `_Raw_view`（官方把四周暈成透明，但底下的畫面還在；alpha × 8 收窄成細邊）——舞台照用暈邊版融進紙面，
  「全身立繪」改看這張。缺了 `npm run dev` 會出現 ⚠ 提示，照提示重跑 `--skins --apply` 就會補上（已存在的 Raw 不重轉）。
- **機甲故事館素材**（`mechs/<wap>/{skins,card}/`、`makers/`，2026-10-17 PLAN-042-B F）：站長 10-16 決定上站（Q5）。
  命名規則在 `scripts/lib/mechLoreAssets.mjs`。塗裝的名稱、順序、隱藏住 mechLore.skins（故事館編輯台，G-1 做好之前顯示「塗裝 N」）。
  轉盤活動的 `Img_Skin_wap*_Raw` 與一般版逐像素相同，不重複收；色票 `Img_custom_wap*` 對不齊塗裝（張數、編號都不合），不用。
  **兵裝組件要人對照**：沒有代碼後綴的 `Img_Skin_wap<兵裝號>` 是換整套模型的商城外觀，自己有 wap 號、看不出是哪台的 ⇒
  本體登記在 `scripts/lib/mechLoreAssets.mjs` 的 `ARMAMENT_SKINS`（註解寫了怎麼查）。沒登記的，差異報告與 `--mech-lore` 報告都會列「本體還沒登記的兵裝組件」。
  **招募插畫要人對照**：切片檔名只有卡池英文鍵（`Dopplesoldner`）、沒有 wap ⇒ 哪台用哪組寫在 `scripts/lib/mechGachaCards.json`。
  新機甲有專屬卡池時，差異報告與 `--mech-lore` 的報告都會列出「對不到機甲的卡池鍵」，在那張表補一行 `"<wap>": "<卡池鍵>"` 再跑一次；
  雙機池（GlaDre、MalAgl）、常駐池（light／medium／heavy／featured）、自選池（SelectTactician、SEFAS、Suit）不是單台的插畫，不必補。
- 這裡只放**讀取端會用到的種類（core）＋NPC 圖庫＋造型＋機甲故事館素材**。招募立繪、大廳場景等 extended 素材、敵方機甲等其餘 _reserve，
  以及站上用不到的其他圖示（道具、勳章、肉鴿…）**不進 repo**，在 repo 外的封存夾（`E:/Mecharashi_Data/site-archive/game/`）。

## 遊戲改版後的歸檔流程（照做就好，不需要 AI）

每一步都是複製貼上；要動腦的只有「誰是誰」，那是站長／管理者的判斷。

1. **擷取**：跑擷取工具，結果會在 `E:/Mecharashi_Data/一般圖片_<版本碼>/`。
2. **差異報告**：`node scripts/diff-game-dump.mjs`，打開它印出的 `_local-notes/<月>/<日>_遊戲擷取差異.html`。
3. **照「下一步」逐條做**。每一步標 ✅ 已完成／⬜ 待做，附可以直接貼的指令：
   先**不加** `--apply` 跑一次（dry-run，只報告、不寫任何東西），沒問題再加 `--apply` 重跑。
   - 「上站」的步驟寫進這個資料夾（之後要 commit）：新機師卡、新機甲、NPC 立繪、技能／BUFF／武器／背包圖示、職業／駕照圖示與陣營徽章、
     機甲塗裝／招募插畫／廠商舞台
   - 「封存」的步驟寫到 repo 外的 `E:/Mecharashi_Data/site-archive/game/`（不必 commit、不部署）：
     介面美術（`ui/`）、其他圖示（`icons/`）、既有機師的新造型（`pilots/<gameId>/`）
   - 只有兩件事要人判斷：新機師的 `--art-key` 填哪張立繪（gameId 與 artKey 不互推）；新卡池鍵是哪台機甲（`scripts/lib/mechGachaCards.json`）。新機甲只放圖、不碰資料庫。
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
node scripts/import-game-assets.mjs --src=latest --emblems --apply           # 職業／駕照圖示、陣營徽章（只補新的）
node scripts/import-game-assets.mjs --src=latest --ui --apply                # 活動／招募／大廳等介面美術 → repo 外封存夾（不部署）
node scripts/import-game-assets.mjs --src=latest --other-icons --apply       # 其他圖示（道具、勳章、肉鴿、車輛、塗裝小圖…）→ repo 外封存夾
node scripts/import-game-assets.mjs --src=latest --skins --apply             # 既有機師的新造型（外觀）→ 這裡的 pilots/<gameId>/skins/（上站）
node scripts/import-game-assets.mjs --src=latest --mech-lore --apply         # 機甲塗裝、招募插畫、廠商舞台 → 這裡的 mechs/<wap>/{skins,card}/、makers/（上站；第一次先 --src=Data）
node scripts/import-game-assets.mjs --promote=<ui/ 底下的路徑> --apply        # 封存夾挑好的 → 這裡的 ui/（上架＝公開，只挑台版已上線的）
node scripts/generate-art-index.mjs                                          # 重產索引（build／predev 也會跑）
node scripts/check-image-refs.mjs                                            # 掃描 DB 與程式碼裡的圖片路徑
```

新圖示要等 `pages-build-deployment` 發布完成才可以請求（含驗證用的 curl），否則 Cloudflare 會把 404 快取住、要 Purge。
圖示的完整流程（指定給資料、留空原則、BUFF 底色）見 `.claude/skills/data-patch/SKILL.md`。

原始擷取（PNG、圖片索引、擷取工具）在本機、不進 repo；命名規則在 `scripts/lib/gameAssetKinds.mjs`（圖示：`gameIconKinds.mjs`）。
