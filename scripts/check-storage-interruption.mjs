/* global chrome */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

// 故障只注入新建配置的 service worker，不修改用户配置或生产产物。
const evidence = resolve('docs/reports/storage-audit-2026-10-30/evidence');
const output = resolve('.output/storage-interruption');
await mkdir(output, { recursive: true });
await mkdir(evidence, { recursive: true });
for (const channel of ['chromium', 'msedge']) {
  const profile = await mkdtemp(resolve(output, `${channel}-`));
  const extension = resolve(`.output/${channel === 'msedge' ? 'edge-mv3' : 'chrome-mv3'}`);
  let context;
  let extensionId;
  const result = { channel, profile, status: 'running', startedAt: new Date().toISOString() };
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {
      channel,
      headless: true,
      timeout: 20_000,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    if (extensionId) assert.equal(id, extensionId);
    extensionId = id;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    return { page, worker };
  };
  const send = async (page, message) => {
    const response = await page.evaluate((request) => chrome.runtime.sendMessage(request), message);
    if (response?.__bingeupError) throw new Error(response.__bingeupError);
    return response;
  };
  try {
    let { page, worker } = await launch();
    const settings = await send(page, { type: 'GET_APP_SETTINGS' });
    await worker.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async (entries) => {
        if ('bingeup:recovery-snapshot' in entries) throw new Error('故障注入：模拟备份配额失败');
        return original(entries);
      };
    });
    const limit = settings.dailyNewWordLimit === 8 ? 9 : 8;
    const saved = await send(page, {
      type: 'SET_APP_SETTINGS',
      settings: { ...settings, dailyNewWordLimit: limit },
    });
    assert.equal(saved.__bingeupEnvelope, 'result-with-backup-warning');
    const before = await send(page, { type: 'GET_STORAGE_DIAGNOSTICS' });
    assert.equal(before.current.storageMeta.pendingBackup, true);
    assert(before.current.storageMeta.revision > before.snapshot.storage.revision);
    await context.close();
    context = null;
    ({ page, worker } = await launch());
    const after = await send(page, { type: 'GET_STORAGE_DIAGNOSTICS' });
    assert.equal(after.current.storageMeta.pendingBackup, false);
    assert.deepEqual(after.snapshot.storage, {
      generation: after.current.storageMeta.generation,
      revision: after.current.storageMeta.revision,
    });
    assert.equal((await send(page, { type: 'GET_APP_SETTINGS' })).dailyNewWordLimit, limit);
    Object.assign(result, {
      status: 'passed',
      extensionId,
      before: before.current.storageMeta,
      after: after.current.storageMeta,
      snapshot: after.snapshot.storage,
    });
  } catch (error) {
    Object.assign(result, { status: 'failed', error: String(error) });
    throw error;
  } finally {
    if (context) await context.close();
    result.completedAt = new Date().toISOString();
    await writeFile(
      resolve(evidence, `${channel}-storage-interruption-result.json`),
      JSON.stringify(result, null, 2),
    );
  }
  console.log(`${channel}：备份失败后关闭浏览器，重启补写成功`);
}
