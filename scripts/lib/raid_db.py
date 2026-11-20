r"""
PLAN-064 武裝討伐擷取：遊戲參數資料包的唯讀存取層（scripts/extract-raid-dungeons.py 用）。

資料包＝陸版客戶端解出的設定表，E:\Mecharashi_Data 底下有兩種落點（內容結構相同）：
  遊戲參數資料包_<日期>\        完整交付包（2026-10-17；另附傷害公式、閱讀指南）
  改版調查_<日期>\資料\          改版調查（2026-11-20 起；報告與證據在上一層）
每一份都有：
  遊戲資料.sqlite   records(table_name,id,name,json)、texts(id,value)（ST:12345 → 簡中）
  戰場配置/<id>.json 每個戰場的 Unity 設定（m_data.m_actorInfos／m_triggerInfos／m_actionGroups…）
  欄位結構/enums.json 枚舉名稱
  索引/來源與版本.json BuildNum／BuildTime

只讀：SQLite 以 mode=ro 開啟；本模組不提供任何寫入。輸出路徑若落在資料包目錄（改版調查則是整個調查夾）底下，guard_output() 會拒絕。
"""
import json, re, sqlite3
from pathlib import Path

DATA_ROOT = Path('E:/Mecharashi_Data')
# ⚠ scripts/import-raid-dungeons.mjs 的 latestPackage() 照同一套規則判斷「資料包換新了沒」，改這裡要一起改。
PACKAGE_GLOBS = ('遊戲參數資料包_*', '改版調查_*/資料')
FIX_ONE = 4294967296  # ProFix64：實數 = RawValue / 2^32


def package_label(src_dir):
    """資料包的名字（＝擷取結果的 meta.build.package）：改版調查的 資料\\ 取上一層的資料夾名。"""
    p = Path(src_dir)
    return p.parent.name if p.name == '資料' else p.name


def _package_sort_key(p):
    label = package_label(p)
    m = re.search(r'_(\d{8})$', label)
    # 日期新的優先；同一天兩種都有時，完整交付包優先
    return (m.group(1) if m else '', label.startswith('遊戲參數資料包_'), label)


def latest_package(root=DATA_ROOT):
    """資料夾名帶日期（遊戲參數資料包_20261017、改版調查_20261120），取日期最新的那份。"""
    cands = [p for g in PACKAGE_GLOBS for p in root.glob(g) if (p / '遊戲資料.sqlite').exists()]
    if not cands:
        raise SystemExit(f'找不到資料包：{root} 底下的 {"、".join(PACKAGE_GLOBS)}（要有 遊戲資料.sqlite）')
    return max(cands, key=_package_sort_key)


def guard_output(out_path, src_dir):
    """資料包是唯讀的原始證據：輸出不得落在資料包目錄裡（改版調查連同上一層的報告與證據一起擋）。"""
    out = Path(out_path).resolve()
    src = Path(src_dir).resolve()
    if src.name == '資料':
        src = src.parent
    if out == src or src in out.parents:
        raise SystemExit(f'拒絕寫入資料包目錄：{out}')


class GameData:
    def __init__(self, src_dir):
        self.src = Path(src_dir)
        db = self.src / '遊戲資料.sqlite'
        self.con = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True)
        self.enums = json.loads((self.src / '欄位結構' / 'enums.json').read_text(encoding='utf-8'))
        self._enum_rev = {}
        self._rec_cache = {}
        self._text_cache = {}
        self.build = self._read_build()

    # ── 版本 ──
    def _read_build(self):
        info = json.loads((self.src / '索引' / '來源與版本.json').read_text(encoding='utf-8'))
        kv = dict(line.split('=', 1) for line in info.get('build_info', '').splitlines() if '=' in line)
        return {'buildNum': kv.get('BuildNum', ''), 'buildTime': kv.get('BuildTime', ''), 'package': package_label(self.src)}

    # ── 設定表 ──
    def rec(self, table, rid):
        """單筆記錄（去掉 _source）；找不到回 None。ID 不跨表唯一，一定要帶表名。"""
        if rid in (None, 0, ''):
            return None
        key = (table, str(rid))
        if key not in self._rec_cache:
            r = self.con.execute('SELECT json FROM records WHERE table_name=? AND id=?', key).fetchone()
            if r:
                j = json.loads(r[0])
                j.pop('_source', None)
                self._rec_cache[key] = j
            else:
                self._rec_cache[key] = None
        return self._rec_cache[key]

    def recs(self, table):
        out = []
        for rid, raw in self.con.execute('SELECT id, json FROM records WHERE table_name=? ORDER BY record_index', (table,)):
            j = json.loads(raw)
            j.pop('_source', None)
            out.append(j)
        return out

    # ── 文字 ──
    def st(self, key):
        """ST:12345 → 簡中文字；空鍵或查不到回 None。"""
        if key in (None, ''):
            return None
        k = str(key)
        if k.startswith('ST:'):
            k = k[3:]
        if k not in self._text_cache:
            r = self.con.execute('SELECT value FROM texts WHERE id=?', (k,)).fetchone()
            self._text_cache[k] = r[0] if r else None
        return self._text_cache[k]

    def string_table(self, sid):
        """ConfigDataStringTable（介面固定字串，例：難度名 1101–1103／1430）。"""
        r = self.rec('ConfigDataStringTable', sid)
        return self.st(r.get('ValueStrKey')) if r else None

    # ── 枚舉 ──
    def enum_name(self, enum, value, strip_prefix=True):
        if enum not in self._enum_rev:
            self._enum_rev[enum] = {v: k for k, v in self.enums[enum]['values'].items()}
        n = self._enum_rev[enum].get(value)
        if n is None:
            return f'?{value}'
        if strip_prefix and '_' in n:
            prefix = enum + '_'
            return n[len(prefix):] if n.startswith(prefix) else n.split('_', 1)[1]
        return n

    def enum_value(self, enum, name):
        vals = self.enums[enum]['values']
        return vals.get(name, vals.get(f'{enum}_{name}'))

    # ── 戰場 ──
    def scene(self, battle_id):
        p = self.src / '戰場配置' / f'{battle_id}.json'
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding='utf-8'))['m_data']


def fx(v):
    """ProFix64 欄位 → 浮點；其他型別原樣。以 RawValue 換算，避免 Value 欄位的浮點誤差。"""
    if isinstance(v, dict) and 'RawValue' in v:
        return v['RawValue'] / FIX_ONE
    return v


def nz(d, skip=()):
    """去掉 0／空值，給輸出瘦身（protobuf 未存的純量本來就是 0）。"""
    return {k: v for k, v in d.items() if v not in (0, '', [], None, {}) and k not in skip}


def is_devnote(text):
    """企劃備註：*# 或 # 開頭（「*#攻擊力加30%」），不給玩家看。"""
    return bool(text) and (text.startswith('*#') or text.startswith('#'))


TAG_RE = re.compile(r'<[^>]+>')
