r"""
卡池動態（機甲 PLAN-042-B Phase J、機師 PLAN-042-A Phase J）：從陸版封包匯出卡池 prefab → scripts/build-gacha-fx.mjs 的輸入（data.json＋tex/）。

── 環境（建一次就好；在 repo 根目錄開 PowerShell）──────────────────────────────
  py -3 -m venv E:\Mecharashi_Data\unitypy-venv
  E:\Mecharashi_Data\unitypy-venv\Scripts\python.exe -m pip install UnityPy==1.25.3 pycryptodome
  pycryptodome 是 UnityCN 解密要的，UnityPy 不會自動帶；少了會報 No module named 'Crypto'。
  系統 Python 沒裝 UnityPy，一律用 venv 裡的 python。每開一個新的 PowerShell 視窗先設一次：
  $PY = 'E:\Mecharashi_Data\unitypy-venv\Scripts\python.exe'

── 用法（PowerShell，repo 根目錄）──────────────────────────────────────────────
  & $PY scripts\export-gacha-prefab.py --list                                          74 個卡池 prefab、對到哪台機甲、站上有沒有動態（✓）
  & $PY scripts\export-gacha-prefab.py --wap 1011 --out E:\Mecharashi_Data\gacha-export      → gacha-export\1011\data.json＋tex\（約 5 秒）
  & $PY scripts\export-gacha-prefab.py --wap 1011 2003 --out E:\Mecharashi_Data\gacha-export 一次多台（各自一個子資料夾）
  & $PY scripts\export-gacha-prefab.py --all --out E:\Mecharashi_Data\gacha-export           有對到機甲的 61 台全部匯出（批次盤點，約 20 秒）
  & $PY scripts\export-gacha-prefab.py --prefab Light --out E:\Mecharashi_Data\gacha-export  依卡池鍵匯出（常駐／自選池這類沒有 wap 的）

  接著：node scripts/build-gacha-fx.mjs E:\Mecharashi_Data\gacha-export\1011 --wap 1011 --dry-run
  沒有 ⚠ 才拿掉 --dry-run 寫進站上；有 ⚠＝那台要等引擎補功能。整套四步（含 commit／push）見 build-gacha-fx.mjs 檔頭。
  遊戲改版後：先讓擷取工具跑完新擷取（貼圖會沿用最新一次擷取的 PNG），再重跑本腳本；新機甲先在 mechGachaCards.json 補卡池鍵。

  機師（--kind pilot；卡池 prefab 是 ui_prefabs_pilotgacha_abs.b 的 PilotGacha<鍵>ItemPrefab，鍵→gameId 用 scripts/lib/pilotGachaCards.json）：
  & $PY scripts\export-gacha-prefab.py --kind pilot --list                                       72 個卡池 prefab、對到哪位機師、站上有沒有動態（✓）
  & $PY scripts\export-gacha-prefab.py --kind pilot --id 10103174 --out E:\Mecharashi_Data\gacha-export-pilot   → gacha-export-pilot\10103174\
  & $PY scripts\export-gacha-prefab.py --kind pilot --all --out E:\Mecharashi_Data\gacha-export-pilot           對照表有的 63 位全部匯出
  接著：node scripts/build-gacha-fx.mjs E:\Mecharashi_Data\gacha-export-pilot\10103174 --pilot 10103174 --dry-run
  機師的相依只載 shader／特效／動畫／招募插畫封包（約 30 個，見 PILOT_SKIP）：全載 108 個在遊戲客戶端開著時會 MemoryError，
  而被跳過的文字圖、介面圖集裡沒有特效會用到的貼圖（2026-10-17 對 72 個匯出實測：0 張解不到）。

── 讀什麼 ──────────────────────────────────────────────────────────────
  封包根目錄與解密金鑰都從擷取工具的 settings.json 讀（source＝陸版客戶端、key＝金鑰）；金鑰不印出、不落地。
  載入 ui_prefabs_wapgacha_abs.b ＋ 它在 AssetBundleManifest 裡的相依封包（遞移閉包，10-17 是 143 個；UnityPy 延遲解壓，約 3 秒），
  所以別包的材質（共用特效材質）、shader 名稱、招募插畫切片、材質再引用的別包貼圖都解得到。
  卡池鍵→wap 用 scripts/lib/mechGachaCards.json（比對時忽略大小寫與連字號：XR／xr、MedusaMK-II／MedusaMKII）。

── 輸出格式（＝10-16 芬里厄試作的 data.json，build-gacha-fx.mjs 照這個讀）────────────
  { prefab, nodes[], materials{}, textures{} }，JSON indent=1、浮點取小數 5 位、PPtr 換成 { pid（字串）, fid }。
  nodes  依深度優先排列：name／active／parent（索引）／depth／rect（RectTransform 原樣，去掉 m_Children／m_Father）
         ／ps（ParticleSystem typetree 原樣）／psr（Renderer typetree＋materials 材質名）／mb（MonoBehaviour：script、fields、
         Image／RawImage 另有 material／texture 名；機師的 Image 另有 sprite 名，10-29 起）／psId（ParticleSystem 元件的 path id，10-29 起，對 UIParticle 的
         m_Particles 用）／canvasGroup／animator（{ enabled, controller }，2026-10-17 起：
         機師卡池 14 位掛循環動畫，builder 要看得到才能報 ⚠；10-29 起多 clips，見 decode_clip）。
         其他元件（TrailRenderer…）不輸出，會在畫面上列出。
  materials  材質名 → shader（完整名）／tex（屬性 → 貼圖名＋scale＋offset）／floats／colors（[r,g,b,a]）。
  textures   貼圖名 → file（tex/<官方貼圖名>.png）／w／h／wrap（[U, V]，Unity TextureWrapMode：0 Repeat、1 Clamp、2 Mirror…）。
             wrap 是 10-17 J-1 加的（流動圖層的主貼圖捲動要知道會不會重複）；除此之外與 10-16 試作逐位元組相同。
  貼圖：從封包解碼；最新擷取（E:/Mecharashi_Data 底下最新的 圖片索引.csv）裡有同一張、像素也一樣時，直接沿用擷取的 PNG
  ——位元組才會和站上 public/images/game/fx/ 既有的共用貼圖一致，重跑不會冒出一堆「內容沒變的圖片變更」。

只讀封包，不改任何東西。
"""
import argparse, csv, json, math, re, shutil, struct, sys, zlib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SETTINGS = Path('E:/Mecharashi_Data/MecharashiExtractor/settings.json')
BUNDLE_SUBDIR = 'Mecharashi/client/Mecharashi_Data/StreamingAssets/ExportAssetBundle'
PREFAB_BUNDLES = {'mech': 'ui_prefabs_wapgacha_abs.b', 'pilot': 'ui_prefabs_pilotgacha_abs.b'}
CARD_FILES = {'mech': 'scripts/lib/mechGachaCards.json', 'pilot': 'scripts/lib/pilotGachaCards.json'}
FX_DIRS = {'mech': 'src/data/gachaFx', 'pilot': 'src/data/gachaFx/pilots'}
# 機師的相依只載這些以外的（見檔頭）：文字圖、介面圖集、字型、其他 prefab 與特效貼圖無關，招募插畫封包例外
PILOT_SKIP = ('ui_textimages_', 'ui_uiimages_', 'ui_fonts', 'ui_prefabs_')
# 招募插畫（2026-10-29 起也匯出：舞台要拼背景、builder 要畫插畫切片）：uipilotgacha 是早期的，uigacha_pilot<ob 版號／se> 是之後的
PILOT_KEEP = re.compile(r'^(ui_textimages_pilotgachaimg_abs\.cn|ui_uiimages_uipilotgacha_abs\.b|ui_uiimages_uigacha_pilot\w+_abs\.b)$')
MANIFEST = 'StandaloneWindows64'
INDEX_FILE = '圖片索引.csv'
# 一起匯出的元件；其他的列在「略過的元件」（CanvasRenderer 每個 UI 節點都有、沒有內容，不列）
EXPORTED = {'RectTransform', 'Transform', 'ParticleSystem', 'ParticleSystemRenderer', 'MonoBehaviour', 'CanvasGroup', 'CanvasRenderer', 'Animator'}

sys.stdout.reconfigure(encoding='utf-8')
ap = argparse.ArgumentParser(description='匯出卡池 prefab（機甲 PLAN-042-B Phase J、機師 PLAN-042-A Phase J）')
ap.add_argument('--kind', choices=['mech', 'pilot'], default='mech', help='機甲（預設）或機師的卡池')
ap.add_argument('--wap', nargs='+', help='機甲遊戲 ID（例 2054），可多個（--kind mech）')
ap.add_argument('--id', nargs='+', help='機師遊戲 ID（例 10103174），可多個（--kind pilot）')
ap.add_argument('--prefab', nargs='+', help='卡池鍵（WapGacha<鍵>PoolItemPrefab／PilotGacha<鍵>ItemPrefab 的 <鍵>，例 Fenrisulfr、HailisMill）')
ap.add_argument('--all', action='store_true', help='對照表有的卡池全部匯出')
ap.add_argument('--list', action='store_true', help='只列出卡池 prefab 與對照')
ap.add_argument('--out', help='匯出根目錄（每台一個子資料夾：wap，沒有 wap 的用卡池鍵）')
ap.add_argument('--settings', default=str(SETTINGS), help=f'擷取工具設定檔（預設 {SETTINGS}）')
ap.add_argument('--bundles', help='封包資料夾（預設 settings.json 的 source 底下的 ExportAssetBundle）')
ap.add_argument('--cache', help='遊戲下載的熱更新封包資料夾（LocalLow/Unity/<公司>_<產品>）：同名封包取安裝目錄與快取裡最新的一份'
                ' （2026-10-29 起，機師用；不給＝只讀安裝目錄，與之前相同）')
ap.add_argument('--dump', default='latest', help='沿用 PNG 的擷取資料夾（預設 latest＝最新一次；none＝一律從封包解碼）')
args = ap.parse_args()
KIND = args.kind
if (args.wap and KIND != 'mech') or (args.id and KIND != 'pilot'):
    ap.error('--wap 是機甲用的、--id 是機師用的（機師要加 --kind pilot）')
if not (args.list or args.wap or args.id or args.prefab or args.all):
    ap.error('要給 --list、--wap／--id、--prefab 或 --all 其中一個')
PREFAB_BUNDLE = PREFAB_BUNDLES[KIND]
if not args.list and not args.out:
    ap.error('匯出要給 --out <匯出根目錄>')

import UnityPy  # noqa: E402（--help 不必載入）

cfg = json.load(open(args.settings, encoding='utf-8-sig'))
k = cfg['key'].strip()
UnityPy.set_assetbundle_decrypt_key(bytes.fromhex(k) if len(k) == 32 else k.encode())
ROOT = Path(args.bundles) if args.bundles else Path(cfg['source']) / BUNDLE_SUBDIR


def bundle_path(name):
    """封包檔：安裝目錄的那份；給了 --cache 時，快取（<封包名去掉副檔名>/<hash>/__data）裡較新的優先——熱更新後的卡池 prefab、
    新機師的招募插畫只在快取裡。只認 .b 與沒有副檔名的（manifest）：多語系封包（.cn／.en…）的快取是遊戲語言那份，不能拿來換。
    都沒有回 None。"""
    paths = [ROOT / name] if (ROOT / name).exists() else []
    if args.cache and (name.endswith('.b') or '.' not in name):
        paths += Path(args.cache).glob(f"{name.rsplit('.', 1)[0]}/*/__data")
    return max(paths, key=lambda p: p.stat().st_mtime) if paths else None


if not bundle_path(PREFAB_BUNDLE):
    sys.exit(f'找不到 {ROOT / PREFAB_BUNDLE}（用 --bundles 指定封包資料夾）')

# ── 卡池鍵 ↔ wap（機師：gameId）──────────────────────────────────────────────
# 變數名沿用機甲的 wap：機師時裡面放的是 gameId
CARDS = json.load(open(REPO / CARD_FILES[KIND], encoding='utf-8'))['cards']
norm = lambda s: s.lower().replace('-', '')
WAP_OF = {norm(key): wap for wap, key in CARDS.items()}


# 官方檔名有一個拼錯：彌造者是 WapGachaDemiurgePoollItemPrefab（Pool 多一個 l）。
# 10-17 對過 74 個 WapGacha*TitleItemPrefab，只有它對不到 PoolItemPrefab；只認字面的話它會整台消失在 --list 裡。
POOL_RE = re.compile(r'^WapGacha(.+?)Pool+ItemPrefab$') if KIND == 'mech' else re.compile(r'^PilotGacha(.+?)ItemPrefab$')


def prefab_key(name):
    m = POOL_RE.match(name)
    return m and m.group(1)


def has_fx(wap):
    return wap is not None and (REPO / FX_DIRS[KIND] / f'{wap}.json').exists()


# ── 載入封包：prefab 封包＋manifest 列的全部相依 ───────────────────────────────
pre = UnityPy.load(str(bundle_path(PREFAB_BUNDLE)))
POOLS = {}  # 卡池鍵 → GameObject 的 ObjectReader
for o in pre.objects:
    if o.type.name == 'GameObject':
        key = prefab_key(o.read().m_Name)
        if key:
            POOLS[key] = o

if args.list:
    rows = sorted(POOLS, key=lambda key: (WAP_OF.get(norm(key)) is None, int(WAP_OF.get(norm(key)) or 0), key))
    print(f'{len(POOLS)} 個卡池 prefab（✓＝站上已有動態 {FX_DIRS[KIND]}/<{"wap" if KIND == "mech" else "gameId"}>.json）')
    for key in rows:
        wap = WAP_OF.get(norm(key))
        print(f"  {'✓' if has_fx(wap) else ' '} {wap or '—':>8}  {key}")
    unmapped = [key for key in POOLS if norm(key) not in WAP_OF]
    if KIND == 'mech':
        print(f'對不到 wap 的 {len(unmapped)} 個：常駐／自選／雙機池不是單台機甲；新機甲要先在 scripts/lib/mechGachaCards.json 補一行')
    else:
        print(f'對不到機師的 {len(unmapped)} 個：常駐／預告／自選／兌換／雙人池不是單人卡池；新機師要先在 scripts/lib/pilotGachaCards.json 補一行')
    sys.exit(0)

targets = []  # (輸出子資料夾名, 卡池鍵)
if args.all:
    targets += [(WAP_OF[norm(key)], key) for key in POOLS if norm(key) in WAP_OF]
for wap in (args.wap or []) + (args.id or []):
    key = CARDS.get(wap)
    real = next((p for p in POOLS if key and norm(p) == norm(key)), None)
    if not real:
        sys.exit(f'{wap}：' + (f'{Path(CARD_FILES[KIND]).name} 沒有這{"台" if KIND == "mech" else "位"}的卡池鍵' if not key else f'封包裡沒有 {key} 的卡池 prefab'))
    targets.append((wap, real))
for key in args.prefab or []:
    real = next((p for p in POOLS if norm(p) == norm(key)), None)
    if not real:
        sys.exit(f'封包裡沒有 {key} 的卡池 prefab（--list 看全部）')
    targets.append((WAP_OF.get(norm(real), real), real))

man = next(o for o in UnityPy.load(str(bundle_path(MANIFEST))).objects if o.type.name == 'AssetBundleManifest').read_typetree()
names = dict(man['AssetBundleNames'])
infos = dict(man['AssetBundleInfos'])
# 相依要取遞移閉包：共用特效材質在 uifxgacha，它的貼圖又可能在 uifxgacha 自己的相依裡（例：Stone_03）
todo, seen = [next(i for i, n in names.items() if n == PREFAB_BUNDLE)], set()
while todo:
    i = todo.pop()
    if i not in seen:
        seen.add(i); todo += infos[i]['AssetBundleDependencies']
deps = sorted(names[i] for i in seen if names[i] != PREFAB_BUNDLE)
SKIPPED = []
if KIND == 'pilot':
    SKIPPED = [d for d in deps if d.startswith(PILOT_SKIP) and not PILOT_KEEP.match(d)]
    deps = [d for d in deps if d not in SKIPPED]
env = UnityPy.load(*[str(p) for p in map(bundle_path, [PREFAB_BUNDLE, *deps]) if p])

# 被跳過的相依封包：sprite 解不到時才找、才載（10-29 補）。瑪蒂妮的 Mask01 在 ui_uiimages_uigacha_mechaob11_abs.b、
# 智者的 Image_Glow 在 ui_textimages_ob13_abs.cn。CAB 名→封包的索引第一次用到時才建（一次只開一個封包，不會 MemoryError）
_skipped_cabs = None


def load_skipped(cab):
    """CAB 名在被跳過的相依封包裡：載進 env、回 True"""
    global _skipped_cabs
    if _skipped_cabs is None:
        _skipped_cabs = {}
        for d in SKIPPED:
            p = bundle_path(d)
            if not p:
                continue
            try:
                for c in getattr(UnityPy.load(str(p)), 'cabs', {}):
                    _skipped_cabs.setdefault(c.lower(), p)
            except Exception:
                pass
    p = _skipped_cabs.pop(cab.lower(), None)
    if p is None:
        return False
    env.load_file(str(p))
    return env.get_cab(cab) is not None
_cab = env.get_cab(next(iter(POOLS.values())).assets_file.name)
POOLS = {key: _cab.objects[o.path_id] for key, o in POOLS.items()}

# ── 擷取的 PNG（沿用用）─────────────────────────────────────────────────────
DUMP, DUMP_IDX = None, {}
if args.dump != 'none':
    droot = Path(cfg.get('output') or 'E:/Mecharashi_Data')
    if args.dump == 'latest':
        found = sorted((p for p in droot.iterdir() if (p / INDEX_FILE).exists()), key=lambda p: (p / INDEX_FILE).stat().st_mtime)
        DUMP = found[-1] if found else None
    else:
        DUMP = Path(args.dump) if Path(args.dump).exists() else droot / args.dump
    if DUMP and (DUMP / INDEX_FILE).exists():
        with open(DUMP / INDEX_FILE, encoding='utf-8-sig', newline='') as f:
            for row in csv.DictReader(f):
                if row.get('type') == 'Texture2D':
                    DUMP_IDX[(row['bundle'], row['path_id'])] = row
    else:
        print(f'⚠ 找不到擷取 {args.dump}，貼圖一律從封包解碼')
        DUMP = None


# ── typetree 清理（與 10-16 試作的 export_proto.py 相同）─────────────────────────
def clean(x):
    """typetree → 可 JSON 化：PPtr 只留 { pid, fid }、去掉 m_GameObject、浮點取小數 5 位（非有限值→0）、位元組→None"""
    if isinstance(x, dict):
        if set(x.keys()) >= {'m_FileID', 'm_PathID'}:
            return {'pid': str(x['m_PathID']), 'fid': x['m_FileID']}
        return {k: clean(v) for k, v in x.items() if k != 'm_GameObject'}
    if isinstance(x, list):
        return [clean(v) for v in x]
    if isinstance(x, float):
        return round(x, 5) if math.isfinite(x) else 0
    if isinstance(x, (bytes, bytearray)):
        return None
    return x


def resolve(owner, ref, lazy=False):
    """typetree 裡的 { m_FileID, m_PathID } → ObjectReader（同檔或相依封包）；空指標或解不到回 None。
    lazy：解不到時到被跳過的相依封包找（只給機師的 sprite 用，其他欄位照舊，匯出檔不變）"""
    fid, pid = ref.get('m_FileID', 0), ref.get('m_PathID', 0)
    if not pid:
        return None
    sf = owner.assets_file
    if fid:
        if fid - 1 >= len(sf.externals):
            return None
        cab = sf.externals[fid - 1].name
        sf = env.get_cab(cab)   # Library/unity default resources 這類解不到
        if sf is None and lazy and load_skipped(cab):
            sf = env.get_cab(cab)
        if sf is None or not hasattr(sf, 'objects'):
            return None
    return sf.objects.get(pid)


# ── AnimationClip（10-29 起，3027 巨像的探照燈）─────────────────────────────────
# 執行期的 Mecanim 片段沒有可讀的曲線，只有 m_MuscleClip（StreamedClip／DenseClip／ConstantClip 三段，順序同 AssetStudio 的
# AnimationClipConverter）與 genericBindings（路徑、屬性都是 CRC32）。路徑相對於 Animator 的節點，walk 完再對回節點名。
# Transform（typeID 4）的屬性是編號：1 位置、2 四元數、3 縮放、4 歐拉角（度，Unity 的 ZXY 順序）；其他元件的是屬性路徑的 CRC32，
# 照下面的候選名對回去，對不到的留數字（builder 報 ⚠）。
ANIM_PROPS = {zlib.crc32(n.encode()): n for n in
              [f'{p}.{a}' for p in ('m_AnchoredPosition', 'm_SizeDelta', 'm_AnchorMin', 'm_AnchorMax', 'm_Pivot', 'm_LocalPosition',
                                    'm_LocalScale', 'm_LocalEulerAnglesHint') for a in 'xyz']
              + [f'm_Color.{a}' for a in 'rgba'] + [f'material._Color.{a}' for a in 'rgba']
              + ['m_Alpha', 'm_IsActive', 'm_Enabled', 'm_FillAmount']
              # 遊戲的 UIShaderVariableProxy（10-29 起）：欄位值寫進材質，屬性名在同一個元件的 m_*_names；UIShiny 的掃光；Image 換 sprite（序列幀）
              + [f'm_float_{i}' for i in range(5)]
              + [f'm_{p}_{i}.{a}' for p in ('vector', 'tilingOffset') for i in range(5) for a in 'xyzw']
              + [f'm_color_{i}.{a}' for i in range(5) for a in 'rgba']
              + ['m_EffectFactor', 'm_Rotation', 'm_Sprite']}
TRANSFORM_ATTR = {1: ('pos', 'xyz'), 2: ('rot', 'xyzw'), 3: ('scale', 'xyz'), 4: ('euler', 'xyz')}


def decode_clip(tt):
    """AnimationClip typetree → { name, start, stop, loop, curves: [{ path（CRC32，之後換成路徑）, type（typeID）, prop, keys }] }。
    keys：Streamed＝[[t, a, b, c, d], …]（t 起的一段三次式 ((a·dt + b)·dt + c)·dt + d，到下一個 t 為止）；
    Dense＝每格一個值換成同格式（a=b=c=0 的常數段，引擎/builder 照 t 取值）；Constant＝[[0, 0, 0, 0, v]]。"""
    mc = tt['m_MuscleClip']
    clip = mc['m_Clip']['data'] if 'data' in mc['m_Clip'] else mc['m_Clip']
    labels, pptr = [], set()
    for b in tt['m_ClipBindingConstant']['genericBindings']:
        if b.get('isPPtrCurve'):
            pptr.add(len(labels))
        if b['typeID'] == 4 and b['attribute'] in TRANSFORM_ATTR:
            nm, comps = TRANSFORM_ATTR[b['attribute']]
            labels += [(b['path'], 4, f'{nm}.{c}') for c in comps]
        else:
            labels.append((b['path'], b['typeID'], ANIM_PROPS.get(b['attribute'], b['attribute'])))
    words = clip['m_StreamedClip']['data']
    raw = struct.pack(f'<{len(words)}I', *words)
    keys, pre, pos = {}, {}, 0
    while pos < len(raw):
        t, n = struct.unpack_from('<fi', raw, pos); pos += 8
        for _ in range(n):
            i, a, b, c, d = struct.unpack_from('<i4f', raw, pos); pos += 20
            if t > -1e30:   # 第一格是 −FLT_MAX：時間 0 之前的常數，用不到（PPtr 曲線例外，見下面的 pre）
                keys.setdefault(i, []).append([round(t, 5)] + [float(f'{v:.6g}') for v in (a, b, c, d)])
            else:
                pre[i] = float(f'{d:.6g}')
    ns = clip['m_StreamedClip'].get('curveCount', len(keys))
    dense = clip['m_DenseClip']
    nd, dt0, rate = dense['m_CurveCount'], dense['m_BeginTime'], dense['m_SampleRate']
    arr = dense['m_SampleArray']
    for f in range(dense['m_FrameCount'] if nd else 0):
        for k in range(nd):
            keys.setdefault(ns + k, []).append([round(dt0 + f / rate, 5), 0, 0, 0, float(f'{arr[f * nd + k]:.6g}')])
    for k, v in enumerate(clip['m_ConstantClip']['data']):
        keys[ns + nd + k] = [[0, 0, 0, 0, float(f'{v:.6g}')]]
    return {
        'name': tt['m_Name'], 'start': round(mc['m_StartTime'], 5), 'stop': round(mc['m_StopTime'], 5), 'loop': bool(mc['m_LoopTime']),
        # PPtr 曲線（10-29 起，10103171 戰部渡的 Img_Sequence 換 sprite）：值是 pptrCurveMapping 的索引；pre＝第一個關鍵格之前的值
        # （−FLT_MAX 那格，序列幀的第 0 張）。只有 PPtr 曲線多這個欄位，其他片段的匯出不變
        'curves': [{'path': p, 'type': ty, 'prop': pr, 'keys': keys.get(i, []), **({'pre': pre.get(i, 0.0)} if i in pptr else {})}
                   for i, (p, ty, pr) in enumerate(labels)],
    }


def export_one(folder, key):
    out = Path(args.out) / str(folder)
    (out / 'tex').mkdir(parents=True, exist_ok=True)
    materials, textures, notes, skipped = {}, {}, [], {}
    src_count = {'擷取': 0, '封包解碼': 0}

    def export_tex(obj):
        d = obj.read()
        name = d.m_Name
        if name in textures:
            return name
        fn = f'tex/{name}.png'
        ts = d.m_TextureSettings
        wrap = [ts.m_WrapU, ts.m_WrapV]   # 0 Repeat、1 Clamp（取樣器的重複方式，shader 沒夾的座標靠它）
        try:
            img = d.image
        except Exception as e:  # 解碼器缺（極少數格式）→ 至少留尺寸
            notes.append(f'貼圖 {name} 解碼失敗：{str(e)[:60]}')
            textures[name] = {'file': None, 'w': d.m_Width, 'h': d.m_Height, 'wrap': wrap}
            return name
        row = DUMP_IDX.get((Path(obj.assets_file.parent.name or '').name, str(obj.path_id))) if DUMP else None
        reuse = False
        if row and int(row['width']) == img.width and int(row['height']) == img.height:
            from PIL import Image, ImageChops
            with Image.open(DUMP / row['path']) as ref:
                reuse = ImageChops.difference(ref.convert('RGBA'), img.convert('RGBA')).getbbox() is None
            if not reuse:
                notes.append(f'貼圖 {name}：擷取的 PNG 和封包不一樣（擷取比遊戲舊？）→ 改用封包解碼')
        if reuse:
            shutil.copyfile(DUMP / row['path'], out / fn)
            src_count['擷取'] += 1
        else:
            img.save(out / fn)
            src_count['封包解碼'] += 1
        textures[name] = {'file': fn, 'w': img.width, 'h': img.height, 'wrap': wrap}
        return name

    def export_sprite(obj):
        """Sprite（機師，10-29 起）→ 裁成它自己那一塊的 PNG，當一張貼圖輸出（名字＝官方 sprite 名，textures 裡標 sprite: true）。
        機師卡池的插畫切片有一半是掛 sprite 的 Image（菲婭的 Img_03、帕洛瑪的 Word…）；builder 照整張貼圖畫。"""
        d = obj.read()
        name = d.m_Name
        if name in textures:
            if not textures[name].get('sprite'):
                notes.append(f'sprite {name} 和同名的貼圖撞名，沿用貼圖那份')
            return name
        fn = f'tex/{name}.png'
        try:
            img = d.image
        except Exception as e:
            notes.append(f'sprite {name} 解碼失敗：{str(e)[:60]}')
            textures[name] = {'file': None, 'w': 0, 'h': 0, 'wrap': [1, 1], 'sprite': True}
            return name
        img.save(out / fn)
        src_count['封包解碼'] += 1
        textures[name] = {'file': fn, 'w': img.width, 'h': img.height, 'wrap': [1, 1], 'sprite': True}
        return name

    def export_mat(obj):
        m = obj.read()
        if m.m_Name in materials:
            return m.m_Name
        try:
            shader = m.m_Shader.deref().read().m_ParsedForm.m_Name
        except Exception:
            shader = '?'
            notes.append(f'材質 {m.m_Name}：讀不到 shader 名')
        texs = {}
        for name, te in m.m_SavedProperties.m_TexEnvs:
            if te.m_Texture and te.m_Texture.path_id:
                try:
                    texs[name] = {'tex': export_tex(te.m_Texture.deref()), 'scale': [te.m_Scale.x, te.m_Scale.y], 'offset': [te.m_Offset.x, te.m_Offset.y]}
                except Exception as e:
                    texs[name] = {'tex': None, 'err': str(e)[:60]}
                    notes.append(f'材質 {m.m_Name} 的 {name}：貼圖解不到（{str(e)[:40]}）')
        materials[m.m_Name] = {
            'shader': shader, 'tex': texs,
            'floats': {n: round(v, 5) for n, v in m.m_SavedProperties.m_Floats},
            'colors': {n: [round(c.r, 5), round(c.g, 5), round(c.b, 5), round(c.a, 5)] for n, c in m.m_SavedProperties.m_Colors},
        }
        return m.m_Name

    nodes = []

    def walk(go_obj, parent=None, depth=0):
        g = go_obj.read()
        node = {'name': g.m_Name, 'active': bool(g.m_IsActive), 'parent': parent, 'depth': depth}
        tf = None
        for c in g.m_Component:
            co = (c.component if hasattr(c, 'component') else c).deref()
            t = co.type.name
            if t in ('RectTransform', 'Transform'):
                tf = co
                node['rect'] = clean(co.read_typetree())
                node['rect'].pop('m_Children', None); node['rect'].pop('m_Father', None)
            elif t == 'ParticleSystem':
                node['ps'] = clean(co.read_typetree())
                node['psId'] = str(co.path_id)   # 10-29 起：對 UIParticle.m_Particles（它只畫清單裡的系統）
            elif t == 'ParticleSystemRenderer':
                tt = clean(co.read_typetree())
                mats = []
                for mp in co.read().m_Materials:
                    if not mp.path_id:   # 官方就沒指定材質（例：各台的 Particle_SSR），照原樣存 None
                        mats.append(None)
                        notes.append(f'{g.m_Name}：粒子沒有指定材質（官方原樣）')
                        continue
                    try:
                        mats.append(export_mat(mp.deref()))
                    except Exception as e:
                        mats.append(None)
                        notes.append(f'{g.m_Name}：粒子材質解不到（{str(e)[:40]}）')
                tt['materials'] = mats
                for kk in list(tt.keys()):
                    if kk.startswith('m_Mesh') or kk in ('m_StaticBatchInfo', 'm_LightProbeVolumeOverride', 'm_ProbeAnchor'):
                        tt.pop(kk, None)
                node['psr'] = tt
            elif t == 'MonoBehaviour':
                try:
                    sc = co.read().m_Script.deref().read().m_ClassName
                except Exception:
                    sc = '?'
                raw = co.read_typetree()
                entry = {'script': sc, 'fields': clean(raw)}
                if sc in ('Image', 'RawImage'):
                    mo = resolve(co, raw.get('m_Material', {}))
                    if mo is not None and mo.type.name == 'Material':
                        entry['material'] = export_mat(mo)
                    elif raw.get('m_Material', {}).get('m_PathID'):
                        notes.append(f'{g.m_Name}：{sc} 的材質在讀不到的檔案（多半是 unity default resources 的預設 UI 材質）')
                    to = resolve(co, raw.get('m_Texture', {}))
                    if to is not None and to.type.name == 'Texture2D':
                        entry['texture'] = export_tex(to)
                    so = resolve(co, raw.get('m_Sprite', {}), lazy=True) if KIND == 'pilot' else None
                    if so is not None and so.type.name == 'Sprite':
                        entry['sprite'] = export_sprite(so)
                node.setdefault('mb', []).append(entry)
            elif t == 'CanvasGroup':
                node['canvasGroup'] = clean(co.read_typetree())
            elif t == 'Animator':
                clips, ctrl = [], None
                try:
                    cobj = co.read().m_Controller.deref()
                    ctrl = cobj.read().m_Name
                    for ref in cobj.read_typetree().get('m_AnimationClips', []):
                        o = resolve(cobj, ref)
                        if o is not None and o.type.name == 'AnimationClip':
                            ctt = o.read_typetree()
                            clip = decode_clip(ctt)
                            # PPtr 曲線的物件表（10-29 起）：sprite 照 Image 的 sprite 一樣裁成 PNG，存名字；不是 sprite 的存 None
                            refs = ctt['m_ClipBindingConstant'].get('pptrCurveMapping') or []
                            if refs and KIND == 'pilot':
                                names = []
                                for r in refs:
                                    so = resolve(o, r, lazy=True)
                                    names.append(export_sprite(so) if so is not None and so.type.name == 'Sprite' else None)
                                clip['pptr'] = names
                            clips.append(clip)
                except Exception as e:
                    notes.append(f'{g.m_Name}：Animator 的控制器／片段讀不到（{str(e)[:60]}）')
                node['animator'] = {'enabled': co.read_typetree().get('m_Enabled', 1), 'controller': ctrl}
                if clips:
                    node['animator']['clips'] = clips
            if t not in EXPORTED:
                skipped.setdefault(t, []).append(g.m_Name)
        nodes.append(node)
        idx = len(nodes) - 1
        if tf is not None:
            for ch in tf.read().m_Children:
                walk(ch.deref().read().m_GameObject.deref(), idx, depth + 1)

    target = POOLS[key].read().m_Name  # 照官方檔名（彌造者是 …Pooll…）
    walk(POOLS[key])
    # 片段的路徑 CRC32 → 相對於 Animator 節點的節點索引（自己＝空路徑）；對不到的留 CRC32（builder 報 ⚠）
    for ai, an in enumerate(nodes):
        for clip in (an.get('animator') or {}).get('clips', []):
            rel = {}
            for i in range(ai, len(nodes)):
                parts, x = [], i
                while x is not None and x != ai:
                    parts.append(nodes[x]['name']); x = nodes[x]['parent']
                if x == ai:
                    rel.setdefault(zlib.crc32('/'.join(reversed(parts)).encode()), i)
            for cv in clip['curves']:
                if cv['path'] in rel:
                    cv['node'] = rel[cv['path']]; del cv['path']
    with open(out / 'data.json', 'w', encoding='utf-8') as f:
        json.dump({'prefab': target, 'nodes': nodes, 'materials': materials, 'textures': textures}, f, ensure_ascii=False, indent=1)

    ps = sum(1 for n in nodes if 'ps' in n)
    print(f'{target} → {out}')
    print(f'  {len(nodes)} 個節點（粒子系統 {ps}）、{len(materials)} 個材質、{len(textures)} 張貼圖（擷取沿用 {src_count["擷取"]}、封包解碼 {src_count["封包解碼"]}）')
    for t, where in sorted(skipped.items()):
        print(f'  · 略過的元件 {t}×{len(where)}：{"、".join(sorted(set(where))[:6])}')
    for msg in dict.fromkeys(notes):
        print(f'  · {msg}')
    if str(folder).isdigit():
        print(f'  下一步：node scripts/build-gacha-fx.mjs "{out}" {"--wap" if KIND == "mech" else "--pilot"} {folder} --dry-run')


for folder, key in targets:
    export_one(folder, key)
