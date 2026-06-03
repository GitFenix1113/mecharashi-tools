/**
 * 鋼嵐工具站 — 機師資料擷取腳本 v3 (API 版)
 *
 * 直接透過官方 WIKI API 取得資料，無需瀏覽器（速度快、穩定）。
 *
 * 功能：
 *   1. 從官方 API 取得 S 級（SSR）機師列表
 *   2. 擷取完整資料：六維、天賦、神經驅動、算力(仿生電腦)
 *   3. 下載機師半身像到 public/images/pilots/{機師名}.png
 *   4. 下載大立繪到 public/images/pilots/{機師名}/full.png
 *   5. 下載技能圖示到 public/images/skills/
 *   6. 輸出 public/data/pilots.json（繁體中文）
 *
 * 使用方式：
 *   node scripts/scrape-pilots-v3.js                          ← 全量 S 級機師（只新增）
 *   node scripts/scrape-pilots-v3.js --pilot=葉夫根尼          ← 指定單一機師（繁體輸入）
 *   node scripts/scrape-pilots-v3.js --no-images               ← 只取文字不下載圖片
 *   node scripts/scrape-pilots-v3.js --force                   ← 強制重抓（忽略已有資料）
 *   node scripts/scrape-pilots-v3.js --limit=3                 ← 只跑前 N 個
 *   node scripts/scrape-pilots-v3.js --all                     ← 含 SR/R 級別
 *   node scripts/scrape-pilots-v3.js --quality=SR              ← 指定品質（SSR/SR/R）
 *   node scripts/scrape-pilots-v3.js --debug                   ← 輸出 debug 資訊
 *   node scripts/scrape-pilots-v3.js --patch                   ← 補丁模式：重抓並合併差異欄位（保護 effects/buffIds）
 *   node scripts/scrape-pilots-v3.js --patch --dump-json       ← 只產生暫存比對 JSON，不寫 Firestore
 *   node scripts/scrape-pilots-v3.js --patch --pilot=葉夫根尼  ← 只補丁指定機師
 */

import * as OpenCC from 'opencc-js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import admin from 'firebase-admin';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── 路徑設定 ──────────────────────────────────────────────────
const API_BASE    = 'https://ma-activity.zlongame.com/common/infodata/mQuery.do';
const APP_KEY     = '1616148215678';
const IMG_BASE    = 'https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo';
// const OUTPUT_JSON = path.join(__dirname, '../public/data/pilots.json');  // 已停用：資料改由 Firestore 管理
const PILOTS_DIR  = path.join(__dirname, '../public/images/pilots');
const SKILLS_DIR  = path.join(__dirname, '../public/images/skills');

// ── 命令列參數 ────────────────────────────────────────────────
const args             = process.argv.slice(2);
const DOWNLOAD_IMG     = !args.includes('--no-images');
const FORCE            = args.includes('--force');
const ALL_QUALITY      = args.includes('--all');
const DEBUG            = args.includes('--debug');
const AUTO             = args.includes('--auto');    // 略過確認，直接寫入 Firestore
const PATCH_MODE       = args.includes('--patch');   // 補丁模式：重抓並合併差異欄位
const QUALITY_FILTER   = (args.find(a => a.startsWith('--quality=')) || '').split('=')[1]?.toUpperCase() || '';
const DUMP_JSON        = args.includes('--dump-json'); // 只輸出暫存 JSON，不寫 Firestore
// --fetch-portraits 模式依賴本地 JSON，已停用（改用 --force 重新擷取）
// const FETCH_PORTRAITS  = args.includes('--fetch-portraits');
const SINGLE_PILOT_RAW = (args.find(a => a.startsWith('--pilot=')) || '').split('=')[1] || '';
const LIMIT            = (() => {
  const l = args.find(a => a.startsWith('--limit='));
  return l ? parseInt(l.split('=')[1]) : Infinity;
})();

// ════════════════════════════════════════════════════════════
// Firebase Admin 初始化
// ════════════════════════════════════════════════════════════
let db = null;

function initFirebase() {
  try {
    const envPath = resolve(ROOT, '.env.migration');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
        const eqIdx = line.indexOf('=');
        if (eqIdx > 0) {
          const k = line.slice(0, eqIdx).trim();
          const v = line.slice(eqIdx + 1).trim();
          if (k && v) process.env[k] = v;
        }
      });
    }
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath) throw new Error('GOOGLE_APPLICATION_CREDENTIALS 未設定');
    const absCredPath = resolve(ROOT, credPath);
    if (!fs.existsSync(absCredPath)) throw new Error(`找不到服務帳號金鑰：${absCredPath}`);
    const serviceAccount = JSON.parse(fs.readFileSync(absCredPath, 'utf-8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return true;
  } catch (err) {
    console.log(`  ⚠ Firebase 初始化失敗: ${err.message}`);
    return false;
  }
}

async function loadFirestorePilots() {
  if (!db) return new Map();
  const snap = await db.collection('pilots').get();
  const map  = new Map();
  for (const doc of snap.docs) {
    const data = { id: doc.id, ...doc.data() };
    if (data.name) map.set(t2s(data.name), data);
  }
  return map;
}

async function batchWrite(collectionName, docs) {
  if (!db || docs.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach(d => {
      batch.set(db.collection(collectionName).doc(d.id), d);
    });
    await batch.commit();
    written += Math.min(500, docs.length - i);
  }
  return written;
}

async function promptConfirm(question) {
  if (AUTO) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(question, answer => {
      rl.close();
      res(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ════════════════════════════════════════════════════════════
// 中文轉換（OpenCC）
// ════════════════════════════════════════════════════════════
const _s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const _t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

// OpenCC 轉換後的自訂修正（處理 OpenCC 轉錯的詞）
const TW_FIXES = [
  ['回覆', '回復'],  // 回复 → OpenCC 轉成 回覆，修正為 回復
  ['裡貝', '里貝'],  // 里贝 → OpenCC 轉成 裡貝，修正為 里貝
];

function applyTwFixes(text) {
  for (const [wrong, correct] of TW_FIXES) {
    text = text.replaceAll(wrong, correct);
  }
  return text;
}

function s2t(text) { return text ? applyTwFixes(_s2t(text)) : text; }
function t2s(text) { return text ? _t2s(text) : text; }

// --pilot 繁體輸入 → 簡體比對
const SINGLE_PILOT_CN = SINGLE_PILOT_RAW ? t2s(SINGLE_PILOT_RAW) : '';

// ════════════════════════════════════════════════════════════
// HTTP 工具
// ════════════════════════════════════════════════════════════
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadImage(url, dest, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) { reject(new Error('too many redirects')); return; }
    if (fs.existsSync(dest) && !FORCE) { resolve(dest); return; }

    const mod  = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);

    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        const redirectUrl = res.headers.location;
        if (!redirectUrl) { reject(new Error('redirect without location')); return; }
        downloadImage(redirectUrl, dest, depth + 1).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      file.close();
      fs.unlink(dest, () => {});
      reject(new Error('timeout'));
    });
  });
}

// ════════════════════════════════════════════════════════════
// API 端點
// ════════════════════════════════════════════════════════════
function apiUrl(target, type, query = '') {
  let url = `${API_BASE}?appkey=${APP_KEY}&target=${target}&type=${type}`;
  if (query) url += `&query=${query}`;
  return url;
}

async function fetchPilotList() {
  const res = await fetchJson(apiUrl('pilot_data', 'list'));
  // API 有重複資料，依 ID 去重
  const seen = new Set();
  return res.data.data.filter(p => {
    if (seen.has(p.ID)) return false;
    seen.add(p.ID);
    return true;
  });
}

async function fetchPilotDetail(id) {
  const res = await fetchJson(apiUrl('pilot_data', 'detail', id));
  return res.data.data;
}

// ════════════════════════════════════════════════════════════
// 大立繪 URL 推導（characterHalf → character，_half → _Raw）
// ════════════════════════════════════════════════════════════
function deriveFullPortraitUrl(halfPortraitUrl) {
  if (!halfPortraitUrl) return '';
  return halfPortraitUrl
    .replace('/characterHalf/', '/character/')
    .replace(/_half\.png$/, '_Raw.png');
}

// ════════════════════════════════════════════════════════════
// 文字清理（移除 <color> / <buf> 標籤）
// ════════════════════════════════════════════════════════════
function cleanRichText(text) {
  if (!text) return '';
  return text
    .replace(/<color=[^>]*>/g, '')
    .replace(/<\/color>/g, '')
    .replace(/<buf[^>]*>\[?/g, '')
    .replace(/\]?<\/buf>/g, '')
    .replace(/<skill[^>]*>\[?/g, '')
    .replace(/\]?<\/skill>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\n/g, '\n')
    .trim();
}

// ════════════════════════════════════════════════════════════
// 職業名稱映射
// ════════════════════════════════════════════════════════════
const PROFESSION_MAP = {
  'Defender': '守護者',
  'Assault': '突擊手',
  'Striker': '格鬥家',
  'Sniper': '狙擊手',
  'Tactician': '戰術家',
  'Engineer': '機械師',
};

const DRIVE_MAP = {
  'Heavy': '重型',
  'Medium': '中型',
  'Light': '輕型',
};

// ════════════════════════════════════════════════════════════
// 武器需求解析（WeaponRequirement）
// ════════════════════════════════════════════════════════════
/**
 * 將 API 的 matchingWeaponType 字串解析為 WeaponRequirement 物件。
 *
 * 格式規則（根據實際 API 資料調整）：
 *   "刀劍+拳套"  → dual  { leftHand: '刀劍', rightHand: '拳套' }
 *   "A+B+C"      → and   { categories: ['A','B','C'] }
 *   "機槍/重機槍" → or    { categories: ['機槍','重機槍'] }
 *   "狙擊步槍"   → or    { categories: ['狙擊步槍'] }
 *   ""  / null   → undefined（技能無武器限制）
 */
function parseWeaponRequirement(raw) {
  const text = s2t(raw || '').trim();
  if (!text) return undefined;

  // 雙持特定組合（左+右）或 AND 邏輯
  if (text.includes('+')) {
    const parts = text.split('+').map(s => s.trim()).filter(Boolean);
    if (parts.length === 2) return { logic: 'dual', leftHand: parts[0], rightHand: parts[1] };
    return { logic: 'and', categories: parts };
  }

  // OR 邏輯（任一武器即可）
  if (/[\/、，,]/.test(text)) {
    const cats = text.split(/[\/、，,]/).map(s => s.trim()).filter(Boolean);
    return { logic: 'or', categories: cats };
  }

  // 單一武器
  return { logic: 'or', categories: [text] };
}

// ════════════════════════════════════════════════════════════
// 組裝機師 JSON
// ════════════════════════════════════════════════════════════
function buildPilotJson(detail, index) {
  const nameTW = s2t(detail.PilotName || detail.name);
  const safeName = nameTW.replace(/[^一-龥a-zA-Z0-9\u3000-\u303f\uff00-\uffef]/g, '');
  const id = `pilot_${String(index + 1).padStart(3, '0')}_${safeName}`;

  // 基本六維（初始）
  const statsBase = {
    melee:       parseInt(detail.Combat) || 0,
    assault:     parseInt(detail.Assault) || 0,
    shooting:    parseInt(detail.Shooting) || 0,
    tactics:     parseInt(detail.Tactics) || 0,
    defense:     parseInt(detail.Defense) || 0,
    engineering: parseInt(detail.Engineering) || 0,
  };

  // 滿級六維
  const manji = detail.manji || {};
  const stats = {
    melee:       parseInt(manji.Combat) || statsBase.melee,
    assault:     parseInt(manji.Assault) || statsBase.assault,
    shooting:    parseInt(manji.Shooting) || statsBase.shooting,
    tactics:     parseInt(manji.Tactics) || statsBase.tactics,
    defense:     parseInt(manji.Defense) || statsBase.defense,
    engineering: parseInt(manji.Engineering) || statsBase.engineering,
  };

  // AP
  const apBase = {
    init:     parseInt(detail.InitialPilotAPValue_PilotAPInitBase) || 0,
    max:      parseInt(detail.MaximumPilotAPValue_PilotAPMaxBase) || 0,
    recovery: parseInt(detail.PilotAPRecoveryperTurn_PilotAPRecoverBase) || 0,
  };
  const ap = {
    init:     parseInt(manji.InitialPilotAPValue_PilotAPInitBase) || apBase.init,
    max:      parseInt(manji.MaximumPilotAPValue_PilotAPMaxBase) || apBase.max,
    recovery: parseInt(manji.PilotAPRecoveryperTurn_PilotAPRecoverBase) || apBase.recovery,
  };

  // 天賦
  const talents = [];
  const talentBase = detail.Talent0_2Ability;
  const talentMax  = detail.Talent3_5Ability;
  if (talentBase) {
    talents.push({
      name:        s2t(talentBase.name),
      type:        '被動技能',
      description: s2t(cleanRichText(talentBase.SpecificEffects)),
      descriptionMax: talentMax ? s2t(cleanRichText(talentMax.SpecificEffects)) : '',
      icon:        talentBase.SkillIcon,
      iconLocal:   `/images/skills/${talentBase.SkillIcon}.png`,
      effects: [], buffIds: [],
    });
  }

  // 神經驅動
  const neuralDrive = [];
  const ndTemplate = detail.NeuralDriveTemplate;
  if (ndTemplate?.ListChipPartition) {
    for (const zone of ndTemplate.ListChipPartition) {
      const chipTypes = (zone.ListAssembled || '').split('/').filter(Boolean);
      const slots = chipTypes.map((type, i) => s2t(`插槽${['一','二','三'][i] || i+1}：${type}芯片`));

      const levels = (zone.ListActivationEffects || []).map((eff, i) => ({
        level:      i + 1,
        minSum:     parseInt(eff.MinimumSum) || 0,
        effect:     s2t(cleanRichText(eff.PassiveSkill?.SpecificEffects || '')),
        skillName:  s2t(eff.PassiveSkill?.name || ''),
        skillIcon:  eff.PassiveSkill?.SkillIcon || '',
        iconLocal:  eff.PassiveSkill?.SkillIcon ? `/images/skills/${eff.PassiveSkill.SkillIcon}.png` : '',
        effects:    [],
        buffIds:    [],
      }));

      neuralDrive.push({
        name:  s2t(zone.name || ''),
        icon:  zone.IconPath || '',
        slots,
        levels,
      });
    }
  }

  // 算力（仿生電腦）
  const biometicComputer = [];
  if (detail.biomimetic_computer_data) {
    for (const unit of detail.biomimetic_computer_data) {
      const entry = {
        id:        unit.ID,
        unitName:  s2t(unit.UnitName || ''),
        title:     s2t(unit.TitleUnitDetails || ''),
        unitType:  unit.UnitType,
        location:  unit.LocationOnMap,
        icon:      unit.icon || '',
      };

      if (unit.skill) {
        entry.skill = {
          id:          unit.skill.ID,
          name:        s2t(unit.skill.name || ''),
          type:        unit.skill.type || '',
          ap:          unit.skill.Ap || '',
          cd:          unit.skill.CD || '',
          weapon:      parseWeaponRequirement(unit.skill.matchingWeaponType),
          description: s2t(cleanRichText(unit.skill.SpecificEffects || unit.skill.describe || '')),
          icon:        unit.skill.SkillIcon || '',
          iconLocal:   unit.skill.SkillIcon ? `/images/skills/${unit.skill.SkillIcon}.png` : '',
        };
      }

      if (unit.AttributeBonus) {
        entry.attributeBonus = unit.AttributeBonus;
      }

      biometicComputer.push(entry);
    }
  }

  // 從仿生電腦提取戰鬥技能
  const skills = biometicComputer
    .filter(u => u.skill)
    .map(u => ({
      name:        u.skill.name,
      type:        u.skill.type === 'EquipmentSkill' ? '主動技能' :
                   u.skill.type === 'Order'          ? '指令技能' :
                   u.skill.type === 'SpecialAssault' ? '主動技能' :
                   u.skill.type === 'PassiveSkill'   ? '被動技能' :
                   (!u.skill.type || u.skill.type === '') ? '被動技能' :
                   s2t(u.skill.type || ''),
      unitType:    u.unitType,
      ap:          u.skill.ap || '',
      cd:          u.skill.cd || '',
      weapon:      u.skill.weapon,
      description: u.skill.description,
      icon:        u.skill.icon,
      iconLocal:   u.skill.iconLocal,
      effects:     [],
      buffIds:     [],
    }))
    .filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i); // 去重

  // 額外資訊
  const additionalInfo = {};
  if (detail.AdditionalInformation) {
    for (const item of detail.AdditionalInformation) {
      additionalInfo[s2t(item.AdditionalInformationTitle || '')] = s2t(item.AdditionalInformationContent || '');
    }
  }

  return {
    id,
    name:        nameTW,
    fullName:    s2t(detail.RealName || detail.PilotName),
    rarity:      detail.quality === 'SSR' ? 'S' :
                 detail.quality === 'SR'  ? 'A' :
                 detail.quality === 'R'   ? 'B' :
                 detail.quality === 'UR'  ? 'EX' : detail.quality,
    class:       PROFESSION_MAP[detail.Profession] || s2t(detail.Occupation || detail.Profession || ''),
    faction:     s2t(detail.Camp || ''),
    license:     DRIVE_MAP[detail.AllowedMechaDriveList_DriveAllowedList] || s2t(detail.AllowedMechaDriveList_DriveAllowedList || ''),
    masterLevel: s2t(manji.MechaDriveLevel || detail.MechaDriveLevel || ''),
    profile: {
      gender:    detail.Gender === 'Male' ? '男' : detail.Gender === 'Female' ? '女' : detail.Gender || '',
      bloodType: detail.BloodType || '',
      height:    detail.Height || '',
      additionalInfo,
    },
    stats,
    statsBase,
    ap,
    apBase,
    talents,
    skills,
    neuralDrive,
    biometicComputer,
    portrait:         `/images/pilots/${safeName}/half.png`,
    fullPortrait:     `/images/pilots/${safeName}/full.png`,
    portraitUrl:      `${IMG_BASE}/characterHalf/${detail.icon || detail.PortraitHeroIcon}.png`,
    fullPortraitUrl:  deriveFullPortraitUrl(`${IMG_BASE}/characterHalf/${detail.icon || detail.PortraitHeroIcon}.png`),
    lore:             s2t(detail.Introduction || ''),
    attack:  0,
    defense: 0,
  };
}

// ════════════════════════════════════════════════════════════
// 圖片下載
// ════════════════════════════════════════════════════════════
async function downloadPilotImages(pilot, detail) {
  if (!DOWNLOAD_IMG) return;

  const safeName = pilot.name.replace(/[^一-龥a-zA-Z0-9\u3000-\u303f\uff00-\uffef]/g, '');
  const pilotSubDir = path.join(PILOTS_DIR, safeName);
  fs.mkdirSync(pilotSubDir, { recursive: true });

  // 半身像（存入子資料夾 half.png）
  const halfDest = path.join(pilotSubDir, 'half.png');
  try {
    await downloadImage(pilot.portraitUrl, halfDest);
    if (DEBUG) process.stdout.write(` [半身✓]`);
  } catch (e) {
    if (DEBUG) process.stdout.write(` [半身✗: ${e.message}]`);
  }

  // 大立繪（full.png）
  if (pilot.fullPortraitUrl) {
    const fullDest = path.join(pilotSubDir, 'full.png');
    try {
      await downloadImage(pilot.fullPortraitUrl, fullDest);
      if (DEBUG) process.stdout.write(` [立繪✓]`);
    } catch (e) {
      if (DEBUG) process.stdout.write(` [立繪✗: ${e.message}]`);
    }
  }

  // 天賦技能圖示
  for (const talent of pilot.talents) {
    if (talent.icon) {
      const dest = path.join(SKILLS_DIR, `${talent.icon}.png`);
      const url  = `${IMG_BASE}/skill/${talent.icon}.png`;
      try { await downloadImage(url, dest); } catch {}
    }
  }

  // 戰鬥技能圖示
  for (const skill of pilot.skills) {
    if (skill.icon) {
      const dest = path.join(SKILLS_DIR, `${skill.icon}.png`);
      const url  = `${IMG_BASE}/skill/${skill.icon}.png`;
      try { await downloadImage(url, dest); } catch {}
    }
  }

  // 神經驅動技能圖示
  for (const zone of pilot.neuralDrive) {
    for (const level of zone.levels) {
      if (level.skillIcon) {
        const dest = path.join(SKILLS_DIR, `${level.skillIcon}.png`);
        const url  = `${IMG_BASE}/skill/${level.skillIcon}.png`;
        try { await downloadImage(url, dest); } catch {}
      }
    }
  }
}

// ════════════════════════════════════════════════════════════
// 補丁模式：合併函式（保護手動填寫的 effects / buffIds）
// ════════════════════════════════════════════════════════════

/**
 * 以技能名稱為 key，合併 fresh API 資料與 Firestore 現有資料。
 * - 覆寫：API 欄位（cd / type / weapon / icon …）
 * - 保護：effects / buffIds（手動維護，不覆寫）
 * - 保護：description（選項 A）— 若 Firestore 描述與官網不同，視為管理者手動覆寫過，保留之；
 *         相同則沿用 API（無差異）。代價：官網日後真的更新描述時不會自動跟進。
 * - 保護：Firestore 有但 API 沒有的技能（直接保留）
 * - 保護：manual 旗標（手動新增技能）
 */
function mergeSkillsArray(existing, fresh) {
  if (!Array.isArray(existing)) return fresh || [];
  const freshMap = new Map((fresh || []).map(s => [s.name, s]));
  const merged = existing.map(skill => {
    const freshSkill = freshMap.get(skill.name);
    if (!freshSkill) return skill;
    // 選項 A：描述與官網不同 → 保留現有（手動覆寫）；相同 → 用 API 值
    const description = (skill.description != null && skill.description !== freshSkill.description)
      ? skill.description
      : freshSkill.description;
    return {
      ...freshSkill,
      description,
      effects:  skill.effects  ?? [],
      buffIds:  skill.buffIds  ?? [],
      ...(skill.manual ? { manual: true } : {}),
    };
  });
  // 新增在 Firestore 沒有的技能（補全，不影響現有）
  for (const freshSkill of (fresh || [])) {
    if (!existing.find(s => s.name === freshSkill.name)) {
      merged.push(freshSkill);
    }
  }
  return merged;
}

/**
 * 合併 talents[]：保護 effects / buffIds / enhancedEffects（手動維護）
 */
function mergeTalentsArray(existing, fresh) {
  if (!Array.isArray(existing)) return fresh || [];
  const freshMap = new Map((fresh || []).map(t => [t.name, t]));
  return existing.map(talent => {
    const freshTalent = freshMap.get(talent.name);
    if (!freshTalent) return talent;
    return {
      ...freshTalent,
      effects:         talent.effects         ?? [],
      buffIds:         talent.buffIds         ?? [],
      enhancedEffects: talent.enhancedEffects ?? undefined,
    };
  });
}

/**
 * 合併 neuralDrive[]：保護各層的 effects / buffIds（手動維護）
 */
function mergeNeuralDriveArray(existing, fresh) {
  if (!Array.isArray(existing)) return fresh || [];
  const freshMap = new Map((fresh || []).map(z => [z.name, z]));
  return existing.map(zone => {
    const freshZone = freshMap.get(zone.name);
    if (!freshZone) return zone;
    const mergedLevels = (zone.levels || []).map((level, i) => {
      const freshLevel = (freshZone.levels || [])[i];
      if (!freshLevel) return level;
      return {
        ...freshLevel,
        effects: level.effects ?? [],
        buffIds: level.buffIds ?? [],
      };
    });
    return { ...freshZone, levels: mergedLevels };
  });
}

/** 淺層 JSON 比較（用於偵測陣列是否有差異） */
function isDifferent(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// ════════════════════════════════════════════════════════════
// 補丁主流程
// ════════════════════════════════════════════════════════════
async function runPatchMode() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  鋼嵐工具站 — 機師補丁模式 (--patch)         ║');
  console.log('╚══════════════════════════════════════════════╝');
  if (DUMP_JSON) console.log('  ⚠  DUMP-JSON 模式 — 只輸出暫存 JSON，不寫入 Firestore');
  if (AUTO)     console.log('  ⚠  AUTO 模式 — 略過確認直接寫入');
  if (SINGLE_PILOT_RAW) console.log(`  指定機師：${SINGLE_PILOT_RAW}（簡體：${SINGLE_PILOT_CN}）`);
  console.log('  保護欄位：effects / buffIds / enhancedEffects（不覆寫）');
  console.log('');

  const firebaseReady = initFirebase();
  if (!firebaseReady) {
    console.log('❌ Firebase 未連線，請確認 .env.migration 與服務帳號金鑰。');
    process.exit(1);
  }
  console.log('🔥 Firebase 連線成功');

  // 載入 Firestore 現有資料
  process.stdout.write('📦 載入 Firestore 機師資料...');
  const existingMap = await loadFirestorePilots(); // key: 簡體名
  console.log(` ${existingMap.size} 個`);

  // 取得 API 機師列表
  console.log('📋 正在取得機師列表...');
  const allPilots = await fetchPilotList();

  let targets;
  if (SINGLE_PILOT_CN) {
    targets = allPilots.filter(p => p.PilotName === SINGLE_PILOT_CN || p.name === SINGLE_PILOT_CN);
    if (targets.length === 0) {
      targets = allPilots.filter(p => (p.PilotName || '').includes(SINGLE_PILOT_CN));
    }
  } else if (QUALITY_FILTER) {
    targets = allPilots.filter(p => p.quality === QUALITY_FILTER);
    console.log(`  → ${QUALITY_FILTER} 品質: ${targets.length} 個`);
  } else if (ALL_QUALITY) {
    targets = allPilots;
  } else {
    targets = allPilots.filter(p => p.quality === 'SSR');
  }

  // 只補丁 Firestore 中已存在的機師
  targets = targets.filter(p => existingMap.has(p.PilotName));
  targets = targets.slice(0, LIMIT);
  console.log(`  → 本次比對：${targets.length} 個（Firestore 已存在）`);
  console.log('');

  const patches = []; // { id, name, updates, diffSummary }

  for (let i = 0; i < targets.length; i++) {
    const pilot = targets[i];
    const nameTW = s2t(pilot.PilotName);
    const existing = existingMap.get(pilot.PilotName);
    process.stdout.write(`  [${i + 1}/${targets.length}] ⏳ ${nameTW}...`);

    try {
      const detail = await fetchPilotDetail(pilot.ID);
      const fresh = buildPilotJson(detail, 0);

      const mergedSkills     = mergeSkillsArray(existing.skills, fresh.skills);
      const mergedTalents    = mergeTalentsArray(existing.talents, fresh.talents);
      const mergedNeuralDrive = mergeNeuralDriveArray(existing.neuralDrive, fresh.neuralDrive);

      const updates = {};
      const diffSummary = [];

      if (isDifferent(existing.skills, mergedSkills)) {
        updates.skills = mergedSkills;
        diffSummary.push('skills');
      }
      if (isDifferent(existing.talents, mergedTalents)) {
        updates.talents = mergedTalents;
        diffSummary.push('talents');
      }
      if (isDifferent(existing.neuralDrive, mergedNeuralDrive)) {
        updates.neuralDrive = mergedNeuralDrive;
        diffSummary.push('neuralDrive');
      }

      if (Object.keys(updates).length > 0) {
        patches.push({ id: existing.id, name: nameTW, updates, diffSummary });
        process.stdout.write(` ✎ [${diffSummary.join(' / ')}]\n`);
      } else {
        process.stdout.write(' — 無差異\n');
      }
    } catch (err) {
      process.stdout.write(` ✗ ${err.message}\n`);
    }

    if (i < targets.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`📊 補丁報告  — 需要更新：${patches.length} / ${targets.length} 個機師`);
  if (patches.length > 0) {
    patches.forEach(p => console.log(`   ✎  ${p.name.padEnd(12)} → ${p.diffSummary.join('、')}`));
  }
  console.log('');

  if (patches.length === 0) {
    console.log('✅ 所有機師資料已是最新，無需補丁。');
    return;
  }

  // DUMP-JSON 模式：只輸出暫存 JSON
  if (DUMP_JSON) {
    const ts = new Date().toISOString().slice(0, 10);
    const tmpPath = path.join(__dirname, `tmp-pilot-patch-${ts}.json`);
    const output = patches.map(({ id, name, updates, diffSummary }) => ({
      id, name, diffSummary, updates,
    }));
    fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`📄 暫存比對 JSON 已輸出：${tmpPath}`);
    console.log('   確認無誤後，移除 --dump-json 參數重新執行即可寫入 Firestore。');
    return;
  }

  // 確認並寫入 Firestore
  const confirmed = await promptConfirm(`將 ${patches.length} 個機師的差異欄位寫入 Firestore？[y/N] `);
  if (!confirmed) { console.log('已取消。'); process.exit(0); }

  process.stdout.write('🔥 寫入 Firestore...');
  let written = 0;
  for (let i = 0; i < patches.length; i += 500) {
    const batch = db.batch();
    patches.slice(i, i + 500).forEach(({ id, updates }) => {
      batch.update(db.collection('pilots').doc(id), updates);
    });
    await batch.commit();
    written += Math.min(500, patches.length - i);
  }
  console.log(` ${written} 筆完成`);
  console.log('');
  console.log(`✅ 補丁完成！${written} 個機師已更新。`);
}

// ════════════════════════════════════════════════════════════
// 主流程
// ════════════════════════════════════════════════════════════
async function main() {
  if (PATCH_MODE) { await runPatchMode(); return; }

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  鋼嵐工具站 — 機師擷取腳本 v4 (Firebase 版)  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  圖片: ${DOWNLOAD_IMG ? '✓' : '✗'}  強制: ${FORCE ? '✓' : '✗'}  全品質: ${ALL_QUALITY ? '✓' : '✗'}  Debug: ${DEBUG ? '✓' : '✗'}  自動: ${AUTO ? '✓' : '✗'}`);
  if (SINGLE_PILOT_RAW) console.log(`  指定機師: ${SINGLE_PILOT_RAW}（簡體: ${SINGLE_PILOT_CN}）`);
  if (QUALITY_FILTER)   console.log(`  指定品質: ${QUALITY_FILTER}`);
  if (isFinite(LIMIT))  console.log(`  數量限制: ${LIMIT}`);
  console.log('');

  // ── 初始化 Firebase ──
  const firebaseReady = initFirebase();
  if (!firebaseReady) {
    console.log('❌ Firebase 未連線，請確認 .env.migration 與服務帳號金鑰。');
    process.exit(1);
  }
  console.log('🔥 Firebase 連線成功');
  console.log('');

  // 建立輸出目錄
  if (DOWNLOAD_IMG) {
    fs.mkdirSync(PILOTS_DIR, { recursive: true });
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  // ── 從 Firestore 載入已有機師資料 ──
  let existingPilots = new Map(); // key: 簡體名 → value: pilot data
  if (!FORCE) {
    process.stdout.write('📦 載入 Firestore 機師資料...');
    existingPilots = await loadFirestorePilots();
    console.log(` ${existingPilots.size} 個`);
  }

  // ── 取得機師列表 ──
  console.log('📋 正在取得機師列表...');
  const allPilots = await fetchPilotList();
  console.log(`  → 總共 ${allPilots.length} 個機師`);

  // ── 篩選目標 ──
  let targets;
  if (SINGLE_PILOT_CN) {
    // 優先精確匹配，找不到再用模糊匹配
    targets = allPilots.filter(p => p.PilotName === SINGLE_PILOT_CN || p.name === SINGLE_PILOT_CN);
    if (targets.length === 0) {
      targets = allPilots.filter(p => p.PilotName.includes(SINGLE_PILOT_CN) || p.name.includes(SINGLE_PILOT_CN));
    }
    if (targets.length === 0) {
      console.log(`  ⚠ 找不到「${SINGLE_PILOT_RAW}」(${SINGLE_PILOT_CN})，可用 S 級機師列表：`);
      const ssrPilots = allPilots.filter(p => p.quality === 'SSR');
      console.log('  ' + ssrPilots.map(p => s2t(p.PilotName)).join('、'));
      process.exit(1);
    }
  } else if (QUALITY_FILTER) {
    targets = allPilots.filter(p => p.quality === QUALITY_FILTER);
    console.log(`  → ${QUALITY_FILTER} 品質: ${targets.length} 個`);
  } else if (ALL_QUALITY) {
    targets = allPilots;
  } else {
    targets = allPilots.filter(p => p.quality === 'SSR');
    console.log(`  → SSR（S級）: ${targets.length} 個`);
  }

  // ── 比對已有，決定要跑哪些 ──
  const toDo = FORCE
    ? targets
    : targets.filter(p => !existingPilots.has(p.PilotName));
  const toSkip = targets.length - toDo.length;

  if (toSkip > 0) console.log(`  → 跳過已有: ${toSkip} 個`);

  const finalTargets = toDo.slice(0, LIMIT);
  console.log(`  → 本次擷取: ${finalTargets.length} 個`);
  console.log('');

  // ── 逐一擷取 ──
  const results = new Map(existingPilots);
  let newCount = 0;

  for (let i = 0; i < finalTargets.length; i++) {
    const pilot = finalTargets[i];
    const nameTW = s2t(pilot.PilotName);
    process.stdout.write(`  [${i + 1}/${finalTargets.length}] ⏳ ${nameTW}...`);

    try {
      const detail = await fetchPilotDetail(pilot.ID);
      // index = 已存在筆數（不含本次已新增的）
      const currentIndex = existingPilots.size + newCount;
      const pilotJson = buildPilotJson(detail, currentIndex);

      // 下載圖片
      await downloadPilotImages(pilotJson, detail);

      results.set(pilot.PilotName, pilotJson);
      newCount++;

      const skillCount = pilotJson.skills.length;
      const bcCount    = pilotJson.biometicComputer.length;
      process.stdout.write(` ✓ [${pilotJson.class}] 技能:${skillCount} 算力:${bcCount} 神驅:${pilotJson.neuralDrive.length}\n`);
    } catch (err) {
      process.stdout.write(` ✗ ${err.message}\n`);
    }

    // 禮貌延遲（避免被限速）
    if (i < finalTargets.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── 整理輸出（去除內部欄位 fullPortraitUrl）──
  const newPilots = Array.from(results.values())
    .filter(p => !existingPilots.has(t2s(p.name)))
    .map(({ fullPortraitUrl, ...rest }) => rest);

  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`📊 差異報告`);
  console.log(`   🆕 新增: ${newPilots.length} 個機師`);
  if (newPilots.length > 0) {
    newPilots.slice(0, 10).forEach(p => console.log(`     + ${p.name}  [${p.class}]  ${p.rarity}級`));
    if (newPilots.length > 10) console.log(`     ... 及其他 ${newPilots.length - 10} 個`);
  }
  console.log('');

  if (newPilots.length === 0) {
    console.log('✅ Firestore 已是最新，無需寫入。');
    return;
  }

  // ── 寫入 Firestore（含確認）──
  const confirmed = await promptConfirm(`將 ${newPilots.length} 個新機師寫入 Firestore？ [y/N] `);
  if (!confirmed) { console.log('已取消。'); process.exit(0); }

  process.stdout.write('🔥 寫入 Firestore...');
  const written = await batchWrite('pilots', newPilots);
  console.log(` ${written} 筆完成`);
  console.log('');
  console.log(`✅ 完成！新增 ${written} 個機師`);
  if (DOWNLOAD_IMG) {
    console.log(`   📁 ${PILOTS_DIR}/{機師名}/half.png, full.png`);
    console.log(`   📁 ${SKILLS_DIR}`);
  }
}

main().catch(err => {
  console.error('\n❌ 腳本執行失敗：', err.message);
  console.error(err.stack);
  process.exit(1);
});
