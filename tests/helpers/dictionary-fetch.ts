import { readFileSync } from 'node:fs';

const DIR = 'public/dictionaries';
const FILES: Record<string, string> = Object.fromEntries(
  [
    'manifest.json',
    'words.json',
    'decks.json',
    'questions.json',
    'legacy-registry.json',
    'source-metadata.json',
    'LICENSE.txt',
  ].map((name) => [name, readFileSync(`${DIR}/${name}`, 'utf8')]),
);

export const DICTIONARY_MANIFEST = JSON.parse(FILES['manifest.json']!) as {
  dictionaryVersion: string;
  registryVersion: string;
  registryHash: string;
};

/** 用真实交付包响应扩展词库请求，供后台与数据迁移测试共用。 */
export function dictionaryFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const name = url.split('/').pop() ?? '';
  const body = FILES[name];
  if (body !== undefined) return Promise.resolve(new Response(body));
  return Promise.reject(new Error(`未预期的词库请求：${url}`));
}
