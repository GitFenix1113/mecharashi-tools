r"""
PLAN-064 A-1：武裝討伐（RaidDungeon）擷取段——遊戲參數資料包 → 中性 JSON。

把陸版資料包裡的武裝討伐整理成「簡中原文＋ID＋結構」，給 scripts/import-raid-dungeons.mjs 組裝成站上文件。
這一段只負責「找到並串起來」：增援時程、條件句、標籤、強化文字這些「轉成人讀文字」的工作都在 Node 端做
（scripts/lib/raidRender.mjs，有 node:test）。所以這裡的觸發器、技能說明都保留原始結構與遊戲標籤。

── 用法（PowerShell，repo 根目錄；venv 見 scripts/export-gacha-prefab.py 檔頭）──────────────
  $PY = 'E:\Mecharashi_Data\unitypy-venv\Scripts\python.exe'
  & $PY -I scripts\extract-raid-dungeons.py                     取最新資料包 → E:\Mecharashi_Data\raid-extract\raid-extract_<BuildNum>.json
  & $PY -I scripts\extract-raid-dungeons.py --src <資料包目錄>    指定資料包
  & $PY -I scripts\extract-raid-dungeons.py --out <檔案.json>     指定輸出檔
  平常不必直接跑：node scripts/import-raid-dungeons.mjs 會在擷取結果過期時自己呼叫本腳本。

── 讀什麼 ──────────────────────────────────────────────────────────────
  RaidDungeonInfo（期）→ 四個難度清單 → RaidDungeonLevelInfo（關）→ BattleMapInfo＋戰場配置/<BattleID>.json
  → 開場單位（m_actorInfos）與觸發器（m_triggerInfos／m_actionGroups，Group 呼叫已內聯）
  → TacticalUnitTemplate → PilotTemplate／PilotInfo（名字、技能、天賦）、WapTemplate（部件）、武器
  → 技能／Buff 說明（含 <buf ID=n> 等遊戲標籤，原樣保留）。
  強敵圖鑑（SkynetStrongEnemyAtlasInfo，type 2）：勢力、台詞、逸聞全文（附原文雜湊，決策十四）。type 1（首領剿滅）略過，解析保持通用。

── 首領面板推算（決策六、開放問題 ① 選 A）──────────────────────────────────
  推算段在 scripts/lib/raid_estimate.py，被 .gitignore 擋住、不進公開 repo
  （備份在 E:\Mecharashi_Data\script-archive\2026-10-11\_本機獨有的保留檔備份\scripts\lib\，改了要一起更新）。
  檔案不在時照常擷取，只是 meta.estimate=false、所有 bossPanels 為 null；import 報告會列 ⬜。

只讀資料包：SQLite 以唯讀模式開啟，輸出若落在資料包目錄內會直接拒絕。
"""
import argparse, datetime, hashlib, json, re, sys
from collections import Counter, defaultdict
from pathlib import Path

sys.dont_write_bytecode = True  # 不在 scripts/lib/ 留 __pycache__
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from raid_db import GameData, latest_package, guard_output, fx, nz, is_devnote  # noqa: E402

try:
    import raid_estimate  # noqa: E402  本機獨有（.gitignore），見檔頭
except ImportError:
    raid_estimate = None

# 解析規則一改就 +1（比照公告管線 PLAN-048）；草稿記下版本，報告能分辨「資料變了」與「解析器變了」。
# v2（2026-10-24）：條件裡引用的 Buff／地形也收進字典。
PARSER_VERSION = 2
DEFAULT_OUT_DIR = Path('E:/Mecharashi_Data/raid-extract')

# 四個難度：清單欄位、站上代碼、StringTable 難度名、遊戲列舉 RaidDungeonLevelDifficulty
DIFFS = [
    ('LevelList', 'normal', 1101, 1),
    ('HardLevelList', 'hard', 1102, 2),
    ('HellLevelList', 'hell', 1103, 3),
    ('Difficult4LevelList', 'd4', 1430, 4),
]

# 觸發器裡留下哪些動作（其餘是鏡頭、動畫、等待…，只計數不輸出）
SUMMON_ACTIONS = {'SummonAtSceneObject', 'Summon'}
BUFF_ADD_ACTIONS = {'AddBuffToActor', 'AddBuffToActors', 'AddBuffToTeam', 'AddBuffToTeamActorRelatedByActor'}
BUFF_REMOVE_ACTIONS = {'RemoveBuffFromActor', 'RemoveBuffFromActors', 'RemoveBuffFromTeam'}
KEEP_OTHER = {'AddPassiveSkill', 'AddMainSkill', 'AddOrRemoveSceneObject', 'SetBlackBoardKeyValue',
              'ModifyGridTerrainEffect', 'ModifyZoneTerrainEffect', 'KillActor', 'RemoveActor',
              'ActorChangeTeam', 'ActorsChangeTeam', 'DecreaseBuffLevel', 'ActorBufLevelChange'}

# 首領＝開場單位裡 ref 是 BOSS／BOSS1／#BOSS2 的戰術單位（雙首領關用編號）。BossID 欄位只供顯示（決策六）。
# Node 端 scripts/lib/raidRender.mjs 的 isBossRef() 用同一條規則。
BOSS_REF_RE = re.compile(r'^#?BOSS\d*$')
TAG_REF_RE = re.compile(r'<(buf ID|skill mainSkill|skill passiveSkill|skill activeSkill|terrian ID)=(\d+)')
TAG_KIND = {'buf ID': 'buff', 'skill mainSkill': 'main', 'skill passiveSkill': 'passive',
            'skill activeSkill': 'active', 'terrian ID': 'terrain'}
PART_KEYS = [('body', 'ConfigDataWapBodyInfo', 'WapBodyID'), ('larm', 'ConfigDataWapArmInfo', 'WapLArmID'),
             ('rarm', 'ConfigDataWapArmInfo', 'WapRArmID'), ('leg', 'ConfigDataWapLegInfo', 'WapLegID')]


def sha1(text):
    return hashlib.sha1((text or '').encode('utf-8')).hexdigest()[:16]


class Extractor:
    def __init__(self, gd):
        self.gd = gd
        self.units, self.vehicles, self.buffs, self.skills, self.terrains = {}, {}, {}, {}, {}
        self.missing = defaultdict(list)       # 種類 → [參照]
        self.text_unresolved = Counter()       # 文字鍵查不到
        self.action_counts = Counter()         # 觸發器動作型別（含略過的）
        self.cond_counts = Counter()           # 觸發器條件型別
        self.level_override_battles = set()

    # ── 小工具 ──
    def miss(self, kind, ref):
        if ref not in self.missing[kind]:
            self.missing[kind].append(ref)

    def text(self, key, kind):
        if key in (None, ''):
            return None
        v = self.gd.st(key)
        if v is None:
            self.text_unresolved[kind] += 1
        return v

    def scan_refs(self, text):
        """說明文字裡的 <buf ID=n>／<skill …=n>／<terrian ID=n>：把被引用的對象也收進字典，Node 端才解得出名稱。"""
        for tag, num in TAG_REF_RE.findall(text or ''):
            kind, rid = TAG_KIND[tag], int(num)
            if kind == 'buff':
                self.buff(rid)
            elif kind == 'terrain':
                self.terrain(rid)
            else:
                self.skill(kind, rid)

    # ── 字典：Buff／技能／地形 ──
    def buff(self, bid):
        if not bid:
            return None
        if bid in self.buffs:
            return bid
        b = self.gd.rec('ConfigDataActorBufInfo', bid)
        if not b:
            self.miss('buff', bid)
            self.buffs[bid] = None
            return None
        name = self.text(b.get('NameDescStrKey'), 'buff.name')
        desc = self.text(b.get('BuffDescStrKey'), 'buff.desc')
        entry = {
            'id': bid, 'name': name, 'desc': desc, 'visible': bool(b.get('Visible')),
            'devnote': is_devnote(desc) or is_devnote(name),
            'funcType': b.get('FuncType', 0),
            'static': not b.get('ActiveCondIds') and not b.get('ExtraActiveCondIds')
                      and not b.get('TriggerType') and not b.get('TriggerType2'),
            'props': [{'id': p['Id'], 'key': self.gd.enum_name('PropertiesId', p['Id']), 'value': round(fx(p['Value']), 6)}
                      for p in b.get('PropertiesList', [])],
            'icon': b.get('Icon') or None,
        }
        self.buffs[bid] = entry
        self.scan_refs(desc)
        return bid

    def skill(self, kind, sid):
        """kind：main（MainSkillInfo，主動）／passive（PassiveSkillInfo）／active（ActiveSkillInfo，攻擊本體）。"""
        if not sid:
            return None
        key = f'{kind}:{sid}'
        if key in self.skills:
            return key
        table = {'main': 'ConfigDataMainSkillInfo', 'passive': 'ConfigDataPassiveSkillInfo',
                 'active': 'ConfigDataActiveSkillInfo'}[kind]
        s = self.gd.rec(table, sid)
        if not s:
            self.miss(f'skill.{kind}', sid)
            self.skills[key] = None
            return None
        entry = {'kind': kind, 'id': sid, 'name': self.text(s.get('NameStrKey'), f'{kind}.name'),
                 'desc': self.text(s.get('SkillDescStrKey'), f'{kind}.desc'), 'icon': s.get('Icon') or None}
        if kind == 'main':
            entry['ap'] = s.get('ApCost') or None
            entry['attacks'] = [w['Id'] for w in s.get('WeaponActiveSkillList', [])]
            for a in entry['attacks']:
                self.skill('active', a)
        if kind == 'passive':
            entry['buffs'] = [b for b in s.get('BufIds', []) if self.buff(b)]
            entry['props'] = [{'id': p['Id'], 'key': self.gd.enum_name('PropertiesId', p['Id']), 'value': round(fx(p['Value']), 6)}
                              for p in s.get('PropertiesList', [])]
        if kind == 'active':
            entry['attackCount'] = s.get('OneRoundAttackCount', 0)
            entry['props'] = [{'id': p['Id'], 'key': self.gd.enum_name('PropertiesId', p['Id']), 'value': round(fx(p['Value']), 6)}
                              for p in s.get('PropertiesList', [])]
        self.skills[key] = entry
        self.scan_refs(entry['desc'])
        return key

    def terrain(self, tid):
        if not tid or tid in self.terrains:
            return tid if tid else None
        t = self.gd.rec('ConfigDataBattleTerrainEffectInfo', tid)
        if not t:
            self.miss('terrain', tid)
            self.terrains[tid] = None
            return None
        self.terrains[tid] = {'id': tid, 'name': self.text(t.get('NameStrKey'), 'terrain.name'),
                              'desc': self.text(t.get('DescStrKey'), 'terrain.desc'), 'show': bool(t.get('ShowInfo'))}
        self.scan_refs(self.terrains[tid]['desc'])
        return tid

    # ── 單位 ──
    def vehicle(self, vid):
        if vid in self.vehicles:
            return vid
        v = self.gd.rec('ConfigDataVehicleInfo', vid)
        if not v:
            self.miss('vehicle', vid)
            self.vehicles[vid] = None
            return None
        self.vehicles[vid] = {'id': vid, 'name': self.text(v.get('NameStrKey'), 'vehicle.name'),
                              'level': v.get('VehicleLevel', 0), 'icon': v.get('Icon') or None,
                              'passives': [k for p in v.get('PassiveSkillIds', []) if (k := self.skill('passive', p))],
                              'defaultBuffs': [b for b in v.get('DefaultBuffs', []) if self.buff(b)]}
        return vid

    def unit(self, tid):
        """戰術單位模板（敵我共用）→ 名字、機體、武器、技能。名字取機師模板（PilotInfo 的名字是內部代號，例「Raid11-1」）。"""
        if tid in self.units:
            return tid
        gd = self.gd
        t = gd.rec('ConfigDataTacticalUnitTemplateInfo', tid)
        if not t:
            self.miss('unit', tid)
            self.units[tid] = None
            return None
        u = {'id': tid, 'npcType': gd.enum_name('NpcActorType', t.get('NpcActorType', 0)),
             'level': t.get('ReplacePilotLevel', 0), 'wapLevels': t.get('ReplaceWapLevel', []),
             'hpPercent': t.get('ReplaceWapHpPercent', []), 'skills': [], 'weapons': [], 'parts': {},
             'defaultBuffs': [b for b in t.get('DefaultBuffs', []) if self.buff(b)]}
        pt = gd.rec('ConfigDataPilotTemplateInfo', t.get('PilotTemplateId'))
        if not pt:
            self.miss('pilotTemplate', t.get('PilotTemplateId'))
        else:
            u['name'] = self.text(pt.get('NameStrKey'), 'unit.name')
            u['pilotTemplateId'] = pt['ID']
            for m in pt.get('MainSkillList', []):
                if (k := self.skill('main', m)):
                    u['skills'].append({'ref': k, 'slot': 'main'})
            for p in pt.get('PassiveSkillList', []) + pt.get('PassiveSkillListInChipZone', []):
                if (k := self.skill('passive', p)):
                    u['skills'].append({'ref': k, 'slot': 'passive'})
            pi = gd.rec('ConfigDataPilotInfo', pt.get('PilotId'))
            if not pi:
                self.miss('pilotInfo', pt.get('PilotId'))
            else:
                u['pilotId'] = pi['ID']
                if (k := self.skill('passive', pi.get('TalentPassiveSkillId'))):
                    u['skills'].insert(0, {'ref': k, 'slot': 'talent'})
                # 等級被動（精銳晶片Ⅰ→Ⅱ→Ⅲ…）：只留模板等級內最高的一階，後一階取代前一階
                lvp = [x for x in pi.get('LevelPassiveSkillList', []) if x['Level'] <= u['level']]
                if lvp and (k := self.skill('passive', max(lvp, key=lambda x: x['Level'])['PassiveSkillId'])):
                    u['skills'].append({'ref': k, 'slot': 'level'})
        wt = gd.rec('ConfigDataWapTemplateInfo', t.get('WapTemplateId'))
        if not wt:
            self.miss('wapTemplate', t.get('WapTemplateId'))
        else:
            for key, table, field in PART_KEYS:
                p = gd.rec(table, wt.get(field))
                if not p:
                    self.miss('wapPart', wt.get(field))
                    continue
                u['parts'][key] = {'id': p['ID'], 'name': self.text(p.get('NameStrKey'), 'part.name')}
                for ps in p.get('PassiveSkillIds', []):
                    if (k := self.skill('passive', ps)):
                        u['skills'].append({'ref': k, 'slot': 'mech'})
            u['mech'] = (u['parts'].get('body') or {}).get('name')
            for w in (t.get('ReplaceWapWeapon') or wt.get('WapWeapon') or []):
                wi = gd.rec('ConfigDataWeaponInfo', w.get('WeaponId'))
                if not wi:
                    self.miss('weapon', w.get('WeaponId'))
                    continue
                u['weapons'].append({'id': wi['ID'], 'slot': w.get('SlotType', 0), 'level': w.get('Level', 0),
                                     'name': self.text(wi.get('NameStrKey'), 'weapon.name'),
                                     'type': gd.enum_name('EquipmentType', wi.get('Type', 0)), 'icon': wi.get('Icon') or None})
                for ps in wi.get('PassiveSkillIdList', []):
                    if (k := self.skill('passive', ps)):
                        u['skills'].append({'ref': k, 'slot': 'weapon'})
            bp = gd.rec('ConfigDataBackpackInfo', t.get('ReplaceBackpackID') or wt.get('BackpackID'))
            if bp:
                u['backpack'] = {'id': bp['ID'], 'name': self.text(bp.get('NameStrKey'), 'backpack.name')}
        self.units[tid] = u
        return tid

    def actor(self, atype, cid):
        """戰場上的一個單位：actorType 1／2 是戰術單位（1 是「玩家型」，第 11、12 期最終關首領用），3 是載具，其餘只記類型。"""
        name = self.gd.enum_name('BattleActorType', atype)
        if atype in (1, 2):
            return ('unit', self.unit(cid))
        if atype == 3:
            return ('vehicle', self.vehicle(cid))
        return (name, cid)

    # ── 戰場 ──
    def conditions(self, cond_ids):
        out = []
        for gid in cond_ids:
            cg = self.gd.rec('ConfigDataBattleCondGroupInfo', gid)
            if not cg:
                self.miss('condGroup', gid)
                continue
            for c in cg.get('CondList', []):
                cc = self.gd.rec('ConfigDataBattleConditionInfo', c)
                if not cc:
                    self.miss('condition', c)
                    continue
                out.append({'type': self.gd.enum_name('BattleConditionType', cc.get('ConditionType', 0)),
                            'param1': cc.get('Param1', 0), 'param4': cc.get('Param4', '')})
        return out

    def achievement(self, aid):
        a = self.gd.rec('ConfigDataBattleAchievementInfo', aid)
        if not a:
            self.miss('achievement', aid)
            return None
        return {'id': aid, 'name': self.text(a.get('NameStrKey'), 'achievement.name'),
                'desc': self.text(a.get('DescStrKey'), 'achievement.desc')}

    def compact_action(self, a):
        """觸發器動作 → 精簡結構；回 None＝與資訊頁無關（鏡頭、動畫…）。"""
        gd = self.gd
        t = gd.enum_name('BattleSceneActionType', a['m_type'])
        self.action_counts[t] += 1
        la = (a.get('m_levelAdaptInfo') or {}).get('m_absoluteLevel') or None
        if t == 'SummonAtSceneObject':
            kind, ref = self.actor(a.get('m_param2', 0), a.get('m_param3', 0))
            return {'t': 'summon', 'team': a.get('m_param1', 0), 'actorType': a.get('m_param2', 0), 'configId': a.get('m_param3', 0),
                    'kind': kind, 'as': a.get('m_paramStr1') or None, 'at': a.get('m_paramStr3') or None, 'level': la}
        if t == 'Summon':
            kind, ref = self.actor(a.get('m_param3', 0), a.get('m_param4', 0))
            return {'t': 'summon', 'team': a.get('m_param2', 0), 'actorType': a.get('m_param3', 0), 'configId': a.get('m_param4', 0),
                    'kind': kind, 'as': a.get('m_paramStr1') or None, 'at': None, 'level': la}
        if t in BUFF_ADD_ACTIONS or t in BUFF_REMOVE_ACTIONS:
            if t in ('AddBuffToTeam', 'RemoveBuffFromTeam'):
                bid, target = a.get('m_param2', 0), {'team': a.get('m_param1', 0)}
            elif t == 'AddBuffToTeamActorRelatedByActor':
                bid, target = a.get('m_param3', 0), {'teamOf': a.get('m_paramStr1') or None}
            else:
                bid, target = a.get('m_param1', 0), {'ref': a.get('m_paramStr1') or None}
            self.buff(bid)
            return {'t': 'addBuff' if t in BUFF_ADD_ACTIONS else 'removeBuff', 'buffId': bid, 'target': target,
                    'many': t.endswith('Actors')}
        if t == 'AddPassiveSkill':
            return {'t': 'addPassive', 'skill': self.skill('passive', a.get('m_param1', 0)), 'target': {'ref': a.get('m_paramStr1') or None}}
        if t == 'AddMainSkill':
            return {'t': 'addMain', 'skill': self.skill('main', a.get('m_param1', 0)), 'target': {'ref': a.get('m_paramStr1') or None}}
        if t == 'AddOrRemoveSceneObject':
            # 召喚點標記：param3=2 且狀態 Open＝開啟（增援預警）；param2=1＝移除
            return {'t': 'marker', 'name': a.get('m_paramStr1') or None,
                    'open': a.get('m_param3') == 2 and a.get('m_paramStr2') == 'Open', 'remove': a.get('m_param2') == 1}
        if t == 'SetBlackBoardKeyValue':
            return {'t': 'setVar', 'key': a.get('m_paramStr1') or '', 'value': a.get('m_param1', 0)}
        if t in ('ModifyGridTerrainEffect', 'ModifyZoneTerrainEffect'):
            # param1＝格子座標（Grid）或區域編號（Zone），param2＝地形效果 ID
            tid = a.get('m_param2', 0)
            return {'t': 'terrain', 'terrainId': self.terrain(tid) if tid else None}
        if t in KEEP_OTHER:
            return {'t': t, 'ref': a.get('m_paramStr1') or None}
        return None

    def triggers(self, scene):
        """觸發器（含動作群組內聯）。只留有意義動作的觸發器，以及設定黑板變數的觸發器（Node 端反推條件語意要用）。"""
        gd = self.gd
        groups = {g.get('m_refName'): g for g in scene.get('m_actionGroups', []) if g.get('m_refName')}
        out = []
        for t in scene.get('m_triggerInfos', []):
            acts = []
            for a in t.get('m_actions', []):
                name = gd.enum_name('BattleSceneActionType', a['m_type'])
                if name == 'Group':
                    g = groups.get(a.get('m_paramStr1'))
                    if g is None:
                        self.miss('actionGroup', a.get('m_paramStr1'))
                        continue
                    for ga in g.get('m_actions', []):
                        if (c := self.compact_action(ga)):
                            c['group'] = a.get('m_paramStr1')
                            acts.append(c)
                    continue
                if (c := self.compact_action(a)):
                    acts.append(c)
            if not acts:
                continue
            conds = []
            for c in t.get('m_conditions', []):
                ctype = gd.enum_name('BattleTriggerConditionType', c.get('m_type', 0))
                self.cond_counts[ctype] += 1
                conds.append(nz({'t': ctype, 'p1': c.get('m_param1', 0), 'p2': c.get('m_param2', 0), 'p3': c.get('m_param3', 0),
                                 'p4': c.get('m_param4', 0), 's': c.get('m_paramStr', ''), 's2': c.get('m_paramStr2', ''),
                                 'not': 1 if c.get('m_not') else 0}))
                # 條件文字會引用到的對象也收進字典（Node 端條件句用 ⟦buf:…⟧／⟦active:…⟧／⟦terrain:…⟧）
                if ctype == 'SkillCast':
                    self.skill('active', c.get('m_param1', 0))
                elif ctype in ('ActorHasBuf', 'ActorBufLevelCompare'):
                    self.buff(c.get('m_param1', 0))
                elif ctype == 'GridTerrainEffectFireSuccess':
                    self.terrain(c.get('m_param3', 0))
            out.append({'i': t.get('m_index'), 'event': gd.enum_name('BattlePipeEventType', t.get('m_eventType', 0)),
                        'repeat': bool(t.get('m_repeatable')), 'conds': conds, 'actions': acts,
                        'note': t.get('m_desc') or None})  # note＝企劃備註，只供除錯，不上站（決策五）
        return out

    def battle(self, bid):
        gd = self.gd
        bm = gd.rec('ConfigDataBattleMapInfo', bid)
        if not bm:
            self.miss('battleMap', bid)
            return None
        lose = self.conditions(bm.get('DefendWinCondGroupIds', []))
        turn_limit = max([c['param1'] for c in lose if c['type'] == 'ReachTurn'] or [0])
        b = {'id': bid, 'name': self.text(bm.get('NameStrKey'), 'battle.name'),
             'winText': self.text(bm.get('AttackWinDescStrKey'), 'battle.win'),
             'loseText': self.text(bm.get('DefendWinDescStrKey'), 'battle.lose'),
             'win': self.conditions([g['BattleCondGroupId'] for g in bm.get('AttackWinCondGroupInfos', [])]),
             'lose': lose, 'turnLimit': turn_limit,
             # 一般成就；HiddenAchievementIds 是開發用（「Raid副本26-1简单 击杀任务」），不擷取
             'achievements': [x for a in bm.get('BattleAchievementIds', []) if (x := self.achievement(a))]}
        gb = gd.rec('ConfigDataBattleMapGlobalBufInfo', bid)
        if gb:
            feature = self.skill('passive', gb.get('BufDescPassiveSkillID'))
            b['globalBuffs'] = {'attacker': [x for x in gb.get('AttackerGlobalBufIds', []) if self.buff(x)],
                                'defender': [x for x in gb.get('DefenderGlobalBufIds', []) if self.buff(x)],
                                'all': [x for x in gb.get('AllGlobalBufIds', []) if self.buff(x)],
                                'feature': feature}
        scene = gd.scene(bid)
        if scene is None:
            self.miss('sceneFile', bid)
            return b
        actors = []
        for a in scene.get('m_actorInfos', []):
            kind, ref = self.actor(a['m_actorType'], a['m_configId'])
            la = (a.get('m_levelAdaptInfo') or {}).get('m_absoluteLevel') or None
            if la:
                self.level_override_battles.add(bid)
            actors.append({'actorType': a['m_actorType'], 'kind': kind, 'configId': a['m_configId'],
                           'ref': a.get('m_refName') or None, 'team': a.get('m_teamType', 0),
                           'x': a.get('m_x'), 'y': a.get('m_y'), 'level': la})
        b['actors'] = actors
        b['triggers'] = self.triggers(scene)
        b['terrain'] = sorted({tid for te in scene.get('m_terrainEffects', [])
                               if (tid := te.get('m_terrainEffectId') or te.get('m_id')) and self.terrain(tid)})
        return b

    # ── 期／關 ──
    def level(self, lid):
        gd = self.gd
        lv = gd.rec('ConfigDataRaidDungeonLevelInfo', lid)
        if not lv:
            self.miss('raidLevel', lid)
            return None
        bounties = []
        for oid in lv.get('OfferRewardList', []):
            o = gd.rec('ConfigDataRaidDungeonOfferRewardInfo', oid)
            if not o:
                self.miss('offerReward', oid)
                continue
            ach = self.achievement(o.get('AchievementId'))
            clue = None
            if o.get('ClueID'):
                c = gd.rec('ConfigDataRaidDungeonClueInfo', o['ClueID'])
                if c:
                    clue = {'id': c['ID'], 'name': self.text(c.get('NameStrKey'), 'clue.name'),
                            'desc': self.text(c.get('DescStrKey'), 'clue.desc'),
                            'details': self.text(c.get('DetailsStrKey'), 'clue.details')}
                else:
                    self.miss('clue', o['ClueID'])
            bounties.append({'id': oid, 'achievement': ach, 'clue': clue})
        out = {'levelId': lid, 'group': lv.get('GroupId', 0), 'order': lv.get('ShowInOrder', 0),
               'isFinal': bool(lv.get('IsDangerousFlag')),
               'name': self.text(lv.get('NameStrKey'), 'level.name'), 'desc': self.text(lv.get('DescStrKey'), 'level.desc'),
               'bossIdField': lv.get('BossID', 0), 'battleId': lv.get('BattleID', 0), 'bounties': bounties}
        if out['isFinal']:
            out['clueGate'] = {'show': lv.get('ShowClueCond', 0), 'unlock': lv.get('UnlockClueCond', 0)}
        if lv.get('BossID'):
            self.unit(lv['BossID'])
        return out

    def open_date(self, season):
        """陸版開放日：OpenTimeId → CommonFuncOpenTimeInfo，或 OpActivityID → OperationalActivityInfo 的開放時間。"""
        gd = self.gd
        tid = season.get('OpenTimeId')
        if not tid and season.get('OpActivityID'):
            act = gd.rec('ConfigDataOperationalActivityInfo', season['OpActivityID'])
            tid = act and act.get('OpenTimeInfoId')
        ot = gd.rec('ConfigDataCommonFuncOpenTimeInfo', tid) if tid else None
        start = ot and (ot.get('ValidStartTime') or ot.get('StartTime'))
        return str(start) if start else None

    def season(self, s):
        sid = s['ID']
        diffs, groups = [], {}
        for field, code, _, _ in DIFFS:
            lids = s.get(field, [])
            if not lids:
                continue
            diffs.append(code)
            for lid in lids:
                lv = self.level(lid)
                if not lv:
                    continue
                g = groups.setdefault(lv['group'], {'group': lv['group'], 'order': lv['order'], 'isFinal': lv['isFinal'],
                                                    'variants': {}})
                g['variants'][code] = lv
        week = []
        for w in s.get('WeekBuffs', []):
            self.buff(w['BuffId'])
            week.append({'week': w['Weeks'], 'buffId': w['BuffId']})
        return {'id': sid, 'name': self.text(s.get('NameStrKey'), 'season.name'),
                'subtitle': self.text(s.get('SubTitleStrKey'), 'season.subtitle'),
                'cnOpen': self.open_date(s), 'difficulties': diffs, 'weekBuffs': week,
                'groups': sorted(groups.values(), key=lambda g: g['group'])}

    # ── 強敵圖鑑（決策十三：人物層）──
    def atlas(self):
        gd = self.gd
        out = []
        for a in gd.recs('ConfigDataSkynetStrongEnemyAtlasInfo'):
            if a.get('StrongEnemyType') != 2:   # 1＝首領剿滅：本計畫略過（解析保持通用）
                continue
            bl = gd.rec('ConfigDataSkynetStrongEnemyBattleLevelInfo', a.get('BattleLevelInfoId'))
            anecdotes = []
            tpl = gd.rec('ConfigDataSkynetStrongEnemyAnecdoteLevelTemplateInfo', a.get('AnecdoteLevelTemplateId'))
            for x in (tpl or {}).get('AnecdoteLevelInfo', []):
                an = gd.rec('ConfigDataSkynetStrongEnemyAnecdoteInfo', x.get('AnecdoteId'))
                if not an:
                    self.miss('anecdote', x.get('AnecdoteId'))
                    continue
                body = self.text(an.get('ParagraphTextStrKey'), 'anecdote.body')
                anecdotes.append({'id': an['ID'], 'unlockLevel': x.get('AnalyticLevel', 0),
                                  'title': self.text(an.get('TitleStrKey'), 'anecdote.title'), 'body': body,
                                  'comment': self.text(an.get('CommentContentStrKey'), 'anecdote.comment'),
                                  'hash': sha1(body)})
            out.append({'id': a['ID'], 'sort': a.get('SortId', 0), 'name': self.text(a.get('NameStrKey'), 'atlas.name'),
                        'quote': self.text(a.get('DescStrKey'), 'atlas.quote'),
                        'enemies': [{'battleId': e.get('BattleMapId'), 'templateId': e.get('TacticalUnitTemplateId')}
                                    for e in a.get('StrongEnemyList', [])],
                        'levelIds': a.get('FunctionLevelIds', []),
                        'faction': bl and {'id': bl['ID'], 'name': self.text(bl.get('CampNameStrKey'), 'faction.name'),
                                           'emblem': bl.get('CampIcon') or None,
                                           'title': self.text(bl.get('LevelNameStrKey'), 'faction.title')},
                        'anecdotes': anecdotes})
        return out

    # ── 面板推算（本機模組；決策六）──
    def panels(self, seasons, battles):
        if raid_estimate is None:
            return None
        out = {}
        for s in seasons:
            for g in s['groups']:
                for code, v in g['variants'].items():
                    b = battles.get(v['battleId'])
                    if not b:
                        continue
                    bosses = [a for a in b.get('actors', []) if a['kind'] == 'unit' and BOSS_REF_RE.match(a['ref'] or '')]
                    for a in bosses:
                        key = f"{v['battleId']}:{a['configId']}"
                        out[key] = raid_estimate.estimate(self.gd, a['configId'], b, a.get('level'))
        return out


def main():
    ap = argparse.ArgumentParser(description='PLAN-064 武裝討伐擷取（唯讀資料包 → 中性 JSON）')
    ap.add_argument('--src', help='資料包目錄（預設：E:\\Mecharashi_Data 底下最新的 遊戲參數資料包_*）')
    ap.add_argument('--out', help='輸出 JSON（預設：E:\\Mecharashi_Data\\raid-extract\\raid-extract_<BuildNum>.json）')
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')

    src = Path(args.src) if args.src else latest_package()
    gd = GameData(src)
    out = Path(args.out) if args.out else DEFAULT_OUT_DIR / f"raid-extract_{gd.build['buildNum'] or 'unknown'}.json"
    guard_output(out, src)

    ex = Extractor(gd)
    seasons = [ex.season(s) for s in sorted(gd.recs('ConfigDataRaidDungeonInfo'), key=lambda s: s['ID'])]
    battles = {}
    for s in seasons:
        for g in s['groups']:
            for v in g['variants'].values():
                if v['battleId'] and v['battleId'] not in battles:
                    battles[v['battleId']] = ex.battle(v['battleId'])
    atlas = ex.atlas()
    panels = ex.panels(seasons, battles)

    difficulty_names = {code: gd.string_table(st_id) for _, code, st_id, _ in DIFFS}
    # 每週規則：可設為目標的關卡組數（ConfigableConst 581）、支援協議生效難度（StringTable 1750「生效难度：初试 磨练」）
    select_max = next((fx(c.get('Value')) for c in gd.recs('ConfigDataConfigableConst')
                       if c.get('ConfigableConstEnumValue') == gd.enum_value('ConfigableConstId', 'RaidDungeonSelectGroupMaxCount')), None)
    rules = {'selectGroupMax': int(select_max) if select_max else None,
             'weekBuffScope': gd.string_table(1750),
             'finalNeedsWeek': gd.string_table(1116), 'freeFirstPass': gd.string_table(1333)}
    n_levels = sum(len(g['variants']) for s in seasons for g in s['groups'])
    data = {
        'meta': {'parserVersion': PARSER_VERSION, 'estimateVersion': getattr(raid_estimate, 'VERSION', None),
                 'estimate': raid_estimate is not None, 'build': gd.build, 'source': str(src),
                 'generatedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
                 'difficultyNames': difficulty_names, 'rules': rules,
                 'counts': {'seasons': len(seasons), 'levels': n_levels, 'battles': len(battles),
                            'units': sum(1 for u in ex.units.values() if u), 'vehicles': sum(1 for v in ex.vehicles.values() if v),
                            'buffs': sum(1 for b in ex.buffs.values() if b), 'skills': sum(1 for s in ex.skills.values() if s),
                            'terrains': sum(1 for t in ex.terrains.values() if t), 'atlas': len(atlas),
                            'panels': len(panels) if panels is not None else None,
                            'levelOverrideBattles': len(ex.level_override_battles)},
                 'missing': {k: v for k, v in ex.missing.items()},
                 'textUnresolved': dict(ex.text_unresolved),
                 'conditionTypes': dict(ex.cond_counts.most_common()),
                 'actionTypes': dict(ex.action_counts.most_common())},
        'seasons': seasons,
        'battles': {str(k): v for k, v in battles.items() if v},
        'units': {str(k): v for k, v in ex.units.items() if v},
        'vehicles': {str(k): v for k, v in ex.vehicles.items() if v},
        'buffs': {str(k): v for k, v in ex.buffs.items() if v},
        'skills': {k: v for k, v in ex.skills.items() if v},
        'terrains': {str(k): v for k, v in ex.terrains.items() if v},
        'atlas': atlas,
        'panels': panels,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    c = data['meta']['counts']
    print(f"資料包 {gd.build['package']}（BuildNum {gd.build['buildNum']}）→ {out}  {out.stat().st_size / 1e6:.2f} MB")
    print(f"  {c['seasons']} 期／{c['levels']} 關／{c['battles']} 戰場；單位 {c['units']}、載具 {c['vehicles']}、Buff {c['buffs']}、"
          f"技能 {c['skills']}、地形 {c['terrains']}；強敵圖鑑 {c['atlas']} 筆")
    miss_total = sum(len(v) for v in ex.missing.values())
    print(f"  斷鏈 {miss_total}" + (f"：{ {k: len(v) for k, v in ex.missing.items()} }" if miss_total else ''))
    if ex.text_unresolved:
        print(f"  ⚠ 文字查不到：{dict(ex.text_unresolved)}")
    print(f"  面板推算：{'%d 筆' % c['panels'] if panels is not None else '⬜ 略過（scripts/lib/raid_estimate.py 不在，見檔頭）'}")


if __name__ == '__main__':
    main()
