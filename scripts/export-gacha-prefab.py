r"""
機甲卡池動態（PLAN-042-B Phase J）：從陸版封包匯出卡池 prefab → scripts/build-gacha-fx.mjs 的輸入（data.json＋tex/）。

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

── 讀什麼 ──────────────────────────────────────────────────────────────
  封包根目錄與解密金鑰都從擷取工具的 settings.json 讀（source＝陸版客戶端、key＝金鑰）；金鑰不印出、不落地。
  載入 ui_prefabs_wapgacha_abs.b ＋ 它在 AssetBundleManifest 裡的相依封包（遞移閉包，10-17 是 143 個；UnityPy 延遲解壓，約 3 秒），
  所以別包的材質（共用特效材質）、shader 名稱、招募插畫切片、材質再引用的別包貼圖都解得到。
  卡池鍵→wap 用 scripts/lib/mechGachaCards.json（比對時忽略大小寫與連字號：XR／xr、MedusaMK-II／MedusaMKII）。

── 輸出格式（＝10-16 芬里厄試作的 data.json，build-gacha-fx.mjs 照這個讀）────────────
  { prefab, nodes[], materials{}, textures{} }，JSON indent=1、浮點取小數 5 位、PPtr 換成 { pid（字串）, fid }。
  nodes  依深度優先排列：name／active／parent（索引）／depth／rect（RectTransform 原樣，去掉 m_Children／m_Father）
         ／ps（ParticleSystem typetree 原樣）／psr（Renderer typetree＋materials 材質名）／mb（MonoBehaviour：script、fields、
         Image／RawImage 另有 material／texture 名）／canvasGroup。其他元件（Animator、TrailRenderer…）不輸出，會在畫面上列出。
  materials  材質名 → shader（完整名）／tex（屬性 → 貼圖名＋scale＋offset）／floats／colors（[r,g,b,a]）。
  textures   貼圖名 → file（tex/<官方貼圖名>.png）／w／h／wrap（[U, V]，Unity TextureWrapMode：0 Repeat、1 Clamp、2 Mirror…）。
             wrap 是 10-17 J-1 加的（流動圖層的主貼圖捲動要知道會不會重複）；除此之外與 10-16 試作逐位元組相同。
  貼圖：從封包解碼；最新擷取（E:/Mecharashi_Data 底下最新的 圖片索引.csv）裡有同一張、像素也一樣時，直接沿用擷取的 PNG
  ——位元組才會和站上 public/images/game/fx/ 既有的共用貼圖一致，重跑不會冒出一堆「內容沒變的圖片變更」。

只讀封包，不改任何東西。
"""
import argparse, csv, json, math, re, shutil, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SETTINGS = Path('E:/Mecharashi_Data/MecharashiExtractor/settings.json')
BUNDLE_SUBDIR = 'Mecharashi/client/Mecharashi_Data/StreamingAssets/ExportAssetBundle'
PREFAB_BUNDLE = 'ui_prefabs_wapgacha_abs.b'
MANIFEST = 'StandaloneWindows64'
INDEX_FILE = '圖片索引.csv'
# 一起匯出的元件；其他的列在「略過的元件」（CanvasRenderer 每個 UI 節點都有、沒有內容，不列）
EXPORTED = {'RectTransform', 'Transform', 'ParticleSystem', 'ParticleSystemRenderer', 'MonoBehaviour', 'CanvasGroup', 'CanvasRenderer'}

sys.stdout.reconfigure(encoding='utf-8')
ap = argparse.ArgumentParser(description='匯出機甲卡池 prefab（PLAN-042-B Phase J）')
ap.add_argument('--wap', nargs='+', help='機甲遊戲 ID（例 2054），可多個')
ap.add_argument('--prefab', nargs='+', help='卡池鍵（WapGacha<鍵>PoolItemPrefab 的 <鍵>，例 Fenrisulfr、Light）')
ap.add_argument('--all', action='store_true', help='有對到 wap 的卡池全部匯出')
ap.add_argument('--list', action='store_true', help='只列出卡池 prefab 與對照')
ap.add_argument('--out', help='匯出根目錄（每台一個子資料夾：wap，沒有 wap 的用卡池鍵）')
ap.add_argument('--settings', default=str(SETTINGS), help=f'擷取工具設定檔（預設 {SETTINGS}）')
ap.add_argument('--bundles', help='封包資料夾（預設 settings.json 的 source 底下的 ExportAssetBundle）')
ap.add_argument('--dump', default='latest', help='沿用 PNG 的擷取資料夾（預設 latest＝最新一次；none＝一律從封包解碼）')
args = ap.parse_args()
if not (args.list or args.wap or args.prefab or args.all):
    ap.error('要給 --list、--wap、--prefab 或 --all 其中一個')
if not args.list and not args.out:
    ap.error('匯出要給 --out <匯出根目錄>')

import UnityPy  # noqa: E402（--help 不必載入）

cfg = json.load(open(args.settings, encoding='utf-8-sig'))
k = cfg['key'].strip()
UnityPy.set_assetbundle_decrypt_key(bytes.fromhex(k) if len(k) == 32 else k.encode())
ROOT = Path(args.bundles) if args.bundles else Path(cfg['source']) / BUNDLE_SUBDIR
if not (ROOT / PREFAB_BUNDLE).exists():
    sys.exit(f'找不到 {ROOT / PREFAB_BUNDLE}（用 --bundles 指定封包資料夾）')

# ── 卡池鍵 ↔ wap ──────────────────────────────────────────────────────────
CARDS = json.load(open(REPO / 'scripts/lib/mechGachaCards.json', encoding='utf-8'))['cards']
norm = lambda s: s.lower().replace('-', '')
WAP_OF = {norm(key): wap for wap, key in CARDS.items()}


# 官方檔名有一個拼錯：彌造者是 WapGachaDemiurgePoollItemPrefab（Pool 多一個 l）。
# 10-17 對過 74 個 WapGacha*TitleItemPrefab，只有它對不到 PoolItemPrefab；只認字面的話它會整台消失在 --list 裡。
POOL_RE = re.compile(r'^WapGacha(.+?)Pool+ItemPrefab$')


def prefab_key(name):
    m = POOL_RE.match(name)
    return m and m.group(1)


def has_fx(wap):
    return wap is not None and (REPO / 'src/data/gachaFx' / f'{wap}.json').exists()


# ── 載入封包：prefab 封包＋manifest 列的全部相依 ───────────────────────────────
pre = UnityPy.load(str(ROOT / PREFAB_BUNDLE))
POOLS = {}  # 卡池鍵 → GameObject 的 ObjectReader
for o in pre.objects:
    if o.type.name == 'GameObject':
        key = prefab_key(o.read().m_Name)
        if key:
            POOLS[key] = o

if args.list:
    rows = sorted(POOLS, key=lambda key: (WAP_OF.get(norm(key)) is None, int(WAP_OF.get(norm(key)) or 0), key))
    print(f'{len(POOLS)} 個卡池 prefab（✓＝站上已有動態 src/data/gachaFx/<wap>.json）')
    for key in rows:
        wap = WAP_OF.get(norm(key))
        print(f"  {'✓' if has_fx(wap) else ' '} {wap or '—':>5}  {key}")
    unmapped = [key for key in POOLS if norm(key) not in WAP_OF]
    print(f'對不到 wap 的 {len(unmapped)} 個：常駐／自選／雙機池不是單台機甲；新機甲要先在 scripts/lib/mechGachaCards.json 補一行')
    sys.exit(0)

targets = []  # (輸出子資料夾名, 卡池鍵)
if args.all:
    targets += [(WAP_OF[norm(key)], key) for key in POOLS if norm(key) in WAP_OF]
for wap in args.wap or []:
    key = CARDS.get(wap)
    real = next((p for p in POOLS if key and norm(p) == norm(key)), None)
    if not real:
        sys.exit(f'wap {wap}：' + ('mechGachaCards.json 沒有這台的卡池鍵' if not key else f'封包裡沒有 WapGacha{key}PoolItemPrefab'))
    targets.append((wap, real))
for key in args.prefab or []:
    real = next((p for p in POOLS if norm(p) == norm(key)), None)
    if not real:
        sys.exit(f'封包裡沒有 WapGacha{key}PoolItemPrefab（--list 看全部）')
    targets.append((WAP_OF.get(norm(real), real), real))

man = next(o for o in UnityPy.load(str(ROOT / MANIFEST)).objects if o.type.name == 'AssetBundleManifest').read_typetree()
names = dict(man['AssetBundleNames'])
infos = dict(man['AssetBundleInfos'])
# 相依要取遞移閉包：共用特效材質在 uifxgacha，它的貼圖又可能在 uifxgacha 自己的相依裡（例：Stone_03）
todo, seen = [next(i for i, n in names.items() if n == PREFAB_BUNDLE)], set()
while todo:
    i = todo.pop()
    if i not in seen:
        seen.add(i); todo += infos[i]['AssetBundleDependencies']
deps = sorted(names[i] for i in seen if names[i] != PREFAB_BUNDLE)
env = UnityPy.load(str(ROOT / PREFAB_BUNDLE), *[str(ROOT / d) for d in deps if (ROOT / d).exists()])
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


def resolve(owner, ref):
    """typetree 裡的 { m_FileID, m_PathID } → ObjectReader（同檔或相依封包）；空指標或解不到回 None"""
    fid, pid = ref.get('m_FileID', 0), ref.get('m_PathID', 0)
    if not pid:
        return None
    sf = owner.assets_file
    if fid:
        if fid - 1 >= len(sf.externals):
            return None
        sf = env.get_cab(sf.externals[fid - 1].name)   # Library/unity default resources 這類解不到
        if sf is None or not hasattr(sf, 'objects'):
            return None
    return sf.objects.get(pid)


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
                node.setdefault('mb', []).append(entry)
            elif t == 'CanvasGroup':
                node['canvasGroup'] = clean(co.read_typetree())
            if t not in EXPORTED:
                skipped.setdefault(t, []).append(g.m_Name)
        nodes.append(node)
        idx = len(nodes) - 1
        if tf is not None:
            for ch in tf.read().m_Children:
                walk(ch.deref().read().m_GameObject.deref(), idx, depth + 1)

    target = POOLS[key].read().m_Name  # 照官方檔名（彌造者是 …Pooll…）
    walk(POOLS[key])
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
        print(f'  下一步：node scripts/build-gacha-fx.mjs "{out}" --wap {folder} --dry-run')


for folder, key in targets:
    export_one(folder, key)
