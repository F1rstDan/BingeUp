/* global chrome, indexedDB */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// 每次运行创建独立配置目录，只操作脚本自己创建的学习卡。
const channel = process.argv[2] ?? 'chromium';
const rounds = Number(process.argv[3] ?? 5);
assert(Number.isInteger(rounds) && rounds > 0 && rounds <= 50);
const extension = resolve('.output/chrome-mv3');
const output = resolve('.output/storage-audit');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, `${channel}-`));
const results = { channel, rounds, profile, observations: [] };
let context;
let extensionId;

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel,
    headless: true,
    timeout: 20_000,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const id = new URL(worker.url()).host;
  if (extensionId) assert.equal(id, extensionId);
  extensionId = id;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  page.setDefaultTimeout(15_000);
  return page;
}

async function send(page, message) {
  const result = await page.evaluate((request) => chrome.runtime.sendMessage(request), message);
  if (result?.__bingeupError) throw new Error(result.__bingeupError);
  return result;
}

try {
  let page = await launch();
  results.browserVersion = context.browser()?.version();
  results.extensionId = extensionId;
  const item = await send(page, { type: 'LEARNING_GET_NEXT' });
  assert.equal(item.kind, 'new-word-presentation');
  const wordId = item.presentation.word.id;
  results.wordId = wordId;
  await send(page, { type: 'LEARNING_SELF_REPORT_KNOWN', wordId });
  for (let round = 1; round <= rounds; round++) {
    await context.close();
    context = null;
    page = await launch();
    const diagnostics = await send(page, { type: 'GET_STORAGE_DIAGNOSTICS' });
    assert.equal(diagnostics.current.counts.cards, 1);
    assert.equal(diagnostics.current.cardStages.selfReported, 1);
    assert.equal(diagnostics.startup.restoredFromSnapshot, false);
    const next = await send(page, { type: 'LEARNING_GET_NEXT' });
    assert(next.kind !== 'new-word-presentation' || next.presentation.word.id !== wordId);
    results.observations.push({ round, cards: 1, selfReported: 1, restored: false });
  }
  // 在测试配置中只删除 cards，保留真实后台自动生成的行为事件。
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bingeup', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('cards', 'readwrite');
      tx.objectStore('cards').clear();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await context.close();
  context = null;
  page = await launch();
  const diagnostics = await send(page, { type: 'GET_STORAGE_DIAGNOSTICS' });
  // 生产选词包含随机抽样；排除其他词，确定性验证丢卡词是否重新成为候选。
  const dictionary = JSON.parse(await readFile(resolve(extension, 'dictionaries/words.json'), 'utf8'));
  const next = await send(page, {
    type: 'LEARNING_GET_NEXT',
    options: { excludedWordIds: dictionary.filter((word) => word.id !== wordId).map((word) => word.id) },
  });
  const repeated = next.kind === 'new-word-presentation' && next.presentation.word.id === wordId;
  results.partialLoss = {
    cards: diagnostics.current.counts.cards,
    events: diagnostics.current.counts.behaviorEvents,
    snapshotCards: diagnostics.snapshot.counts?.cards,
    restored: diagnostics.startup.restoredFromSnapshot,
    repeated,
  };
  assert.equal(results.partialLoss.cards, 0);
  assert(results.partialLoss.events > 0);
  assert.equal(results.partialLoss.snapshotCards, 1);
  assert.equal(results.partialLoss.restored, false);
  assert.equal(repeated, true);
  console.log(JSON.stringify(results, null, 2));
} finally {
  if (context) await context.close();
  await writeFile(resolve(output, `${channel}-result.json`), JSON.stringify(results, null, 2));
}
