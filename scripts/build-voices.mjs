#!/usr/bin/env node
/**
 * VOICEVOX 事前音声生成スクリプト
 *
 * 使い方:
 *   1. VOICEVOX Engine を起動 (http://localhost:50021)
 *   2. `node scripts/build-voices.mjs [workId]`
 *      - workId 省略: catalog.json の全作品を生成
 *      - workId 指定: その作品のみ生成
 *
 * 出力:
 *   data/audio/<workId>/<contentId>.wav
 *   data/audio/<workId>/manifest.json   (item_id → {speaker, hash, bytes})
 *
 * キャッシュ: 同じテキスト+話者の場合は再生成をスキップ (manifest.json の hash 照合)
 *
 * キャラ個別の話者指定: キャラクターの `voicevoxSpeaker` プロパティを使用
 *   例: {"id":"char1","gender":"male","voicevoxSpeaker":11}
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
const AUDIO_ROOT = path.join(ROOT, 'data', 'audio');
const VOICEVOX_URL = process.env.VOICEVOX_URL || 'http://localhost:50021';

// gender → VOICEVOX 話者 ID マッピング
const DEFAULT_SPEAKER = {
  male: 13,    // 青山龍星 (ノーマル)
  female: 8,   // 春日部つむぎ (ノーマル)
  neutral: 2,  // 四国めたん (ノーマル)
};

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h) + s.charCodeAt(i); h |= 0; }
  return (h >>> 0).toString(36);
}

function speakerFor(character) {
  if (!character) return DEFAULT_SPEAKER.neutral;
  if (typeof character.voicevoxSpeaker === 'number') return character.voicevoxSpeaker;
  return DEFAULT_SPEAKER[character.gender] ?? DEFAULT_SPEAKER.neutral;
}

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }

async function readJsonSafe(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function synthesize(text, speaker) {
  const queryRes = await fetch(
    `${VOICEVOX_URL}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    { method: 'POST' }
  );
  if (!queryRes.ok) throw new Error(`audio_query failed (${queryRes.status}): ${await queryRes.text()}`);
  const query = await queryRes.json();
  // 事前生成は等速で書き出す。再生速度はビューワ側で audio.playbackRate で制御。
  query.speedScale = 1.0;
  query.outputSamplingRate = 24000; // サイズ節約 (デフォ 24000 と同値だが明示)

  const synRes = await fetch(
    `${VOICEVOX_URL}/synthesis?speaker=${speaker}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav' },
      body: JSON.stringify(query),
    }
  );
  if (!synRes.ok) throw new Error(`synthesis failed (${synRes.status}): ${await synRes.text()}`);
  return Buffer.from(await synRes.arrayBuffer());
}

async function buildWork(workEntry) {
  const contentPath = path.join(ROOT, workEntry.contentUrl);
  const scenario = await readJsonSafe(contentPath);
  if (!scenario) {
    console.warn(`  ⚠ シナリオ読み込み失敗: ${workEntry.contentUrl}`);
    return;
  }
  const charMap = {};
  (scenario.characters || []).forEach(c => { charMap[c.id] = c; });

  const outDir = path.join(AUDIO_ROOT, workEntry.id);
  await ensureDir(outDir);

  const manifestPath = path.join(outDir, 'manifest.json');
  const prev = (await readJsonSafe(manifestPath)) || { items: {} };
  const manifest = {
    workId: workEntry.id,
    generatedAt: new Date().toISOString(),
    engine: 'voicevox',
    engineUrl: VOICEVOX_URL,
    items: {},
  };

  let generated = 0, cached = 0, skipped = 0, failed = 0;

  for (const item of (scenario.content || [])) {
    if (item.type === 'pageBreak') continue;
    const text = (item.text || '').trim();
    if (!text) { skipped++; continue; }

    const ch = item.characterId ? charMap[item.characterId] : null;
    const speaker = speakerFor(ch);
    const hash = simpleHash(text + '|sp=' + speaker);
    const outFile = path.join(outDir, `${item.id}.wav`);

    // キャッシュ照合: manifest に同一hashがあり、かつファイルが存在すればスキップ
    const prevItem = prev.items?.[item.id];
    if (prevItem && prevItem.hash === hash) {
      try {
        const stat = await fs.stat(outFile);
        if (stat.size > 0) {
          manifest.items[item.id] = prevItem;
          cached++;
          continue;
        }
      } catch {}
    }

    process.stdout.write(`  [${workEntry.id}] ${item.id} (sp=${speaker}, ${text.length}文字)... `);
    try {
      const wav = await synthesize(text, speaker);
      await fs.writeFile(outFile, wav);
      manifest.items[item.id] = { speaker, hash, chars: text.length, bytes: wav.length };
      console.log(`OK (${(wav.length / 1024).toFixed(1)}KB)`);
      generated++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      failed++;
    }
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  → 生成=${generated} / キャッシュ=${cached} / スキップ=${skipped} / 失敗=${failed}`);
}

async function main() {
  // ヘルスチェック
  try {
    const r = await fetch(`${VOICEVOX_URL}/version`);
    const v = (await r.text()).replace(/"/g, '').trim();
    console.log(`✓ VOICEVOX Engine v${v} (${VOICEVOX_URL})`);
  } catch (e) {
    console.error(`✗ VOICEVOX Engine に接続できません: ${VOICEVOX_URL}`);
    console.error(`  VOICEVOX を起動してから再実行してください。`);
    console.error(`  起動確認: ブラウザで ${VOICEVOX_URL}/speakers を開いて JSON が返るか確認`);
    process.exit(1);
  }

  const catalog = await readJsonSafe(CATALOG_PATH);
  if (!catalog) { console.error(`catalog.json が読めません: ${CATALOG_PATH}`); process.exit(1); }

  await ensureDir(AUDIO_ROOT);

  const filterId = process.argv[2];
  const targets = filterId
    ? catalog.works.filter(w => w.id === filterId)
    : catalog.works;

  if (!targets.length) {
    console.error(`作品が見つかりません: ${filterId || '(catalog空)'}`);
    process.exit(1);
  }

  console.log(`\n話者マッピング: male=${DEFAULT_SPEAKER.male} / female=${DEFAULT_SPEAKER.female} / neutral=${DEFAULT_SPEAKER.neutral}`);
  console.log(`対象: ${targets.map(w => w.id).join(', ')}\n`);

  for (const work of targets) {
    console.log(`=== ${work.title} (${work.id}) ===`);
    await buildWork(work);
    console.log('');
  }

  console.log('完了しました。');
}

main().catch(e => { console.error('エラー:', e); process.exit(1); });
