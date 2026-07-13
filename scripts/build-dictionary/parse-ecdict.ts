/**
 * ECDICT CSV 解析与例句提取模块。
 */
import type { EcdictRow, ParsedExample } from './types';

/** ECDICT CSV 列名 */
const ECDICT_COLUMNS = [
  'word',
  'phonetic',
  'definition',
  'translation',
  'pos',
  'collins',
  'oxford',
  'tag',
  'bnc',
  'frq',
  'exchange',
  'detail',
  'audio',
] as const;

/** 解析 ECDICT CSV 的一行。 */
export function parseEcdictRow(line: string): EcdictRow | null {
  const fields = parseCSVLine(line);
  if (fields.length < ECDICT_COLUMNS.length) return null;

  const row: Record<string, string> = {};
  for (let i = 0; i < ECDICT_COLUMNS.length; i++) {
    row[ECDICT_COLUMNS[i]!] = fields[i] ?? '';
  }

  return {
    word: row.word ?? '',
    phonetic: row.phonetic ?? '',
    definition: row.definition ?? '',
    translation: row.translation ?? '',
    pos: row.pos ?? '',
    collins: row.collins ?? '',
    oxford: row.oxford ?? '',
    tag: row.tag ?? '',
    bnc: row.bnc ?? '',
    frq: row.frq ?? '',
    exchange: row.exchange ?? '',
    detail: row.detail ?? '',
  };
}

/** 解析 CSV 行（处理引号内的逗号）。 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** 解析词性字符串为数组。 */
export function parsePartOfSpeech(pos: string): string[] {
  if (!pos) return [];
  return pos
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normalizePOS);
}

/**
 * ECDICT 的 pos 字段大多为空，词性前缀往往写在 translation 里。
 * 例如 `vt. 放弃, 抛弃\nn. 放任, 无拘束` → ['v.', 'n.']。
 * 按换行分多行，每行匹配开头的词性缩写。
 */
export function extractPosFromTranslation(translation: string): string[] {
  if (!translation) return [];
  const posSet = new Set<string>();
  for (const line of translation.split(/\n/)) {
    const m = line.match(/^\s*([a-zA-Z]+)\./);
    if (m) {
      const normalized = normalizePOS(m[1]!);
      // 只保留合法的词性，过滤掉 mr.、dr. 这类前缀
      if (VALID_POS_ABBREVS.has(normalized)) {
        posSet.add(normalized);
      }
    }
  }
  return [...posSet];
}

/** 合法词性缩写集合，extractPosFromTranslation 用作白名单。 */
const VALID_POS_ABBREVS = new Set([
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'num.',
  'art.',
  'int.',
  'det.',
  'abbr.',
  'aux.',
]);

/** 标准化词性标记。 */
function normalizePOS(pos: string): string {
  const normalized = pos.toLowerCase();
  const mapping: Record<string, string> = {
    noun: 'n.',
    verb: 'v.',
    adjective: 'adj.',
    adverb: 'adv.',
    preposition: 'prep.',
    conjunction: 'conj.',
    pronoun: 'pron.',
    interjection: 'int.',
    numeral: 'num.',
    article: 'art.',
    determiner: 'det.',
    abbreviation: 'abbr.',
    auxiliary: 'aux.',
    n: 'n.',
    v: 'v.',
    adj: 'adj.',
    adv: 'adv.',
    prep: 'prep.',
    conj: 'conj.',
    pron: 'pron.',
    int: 'int.',
    num: 'num.',
    art: 'art.',
    det: 'det.',
    abbr: 'abbr.',
    aux: 'aux.',
    vi: 'v.',
    vt: 'v.',
  };
  return mapping[normalized] ?? normalized;
}

/** 解析考试标签。 */
export function parseTags(tag: string): string[] {
  if (!tag) return [];
  return tag
    .split(' ')
    .filter(Boolean)
    .map((t) => t.trim().toLowerCase());
}

/** 解析数字字段（frq/bnc）。 */
export function parseNumberField(value: string): number {
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 从 ECDICT detail 字段提取例句。
 * detail 格式示例：
 *   "n. 放弃；遗弃\nv. to leave sb/sth 抛弃；遗弃\n  He abandoned his studies. 他放弃了他的学业。"
 * 返回中文翻译紧随的英文句子。
 */
export function extractExample(
  word: string,
  detail: string,
  translation: string,
): ParsedExample | null {
  if (!detail) return null;

  // 尝试匹配 "英文句子. 中文翻译。" 模式
  // 英文句子以大写字母开头，包含目标词，以 .!? 结尾
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sentencePattern = new RegExp(
    `([A-Z][^.!?]*?\\b${escapedWord}\\w*\\b[^.!?]*[.!?])\\s*([^A-Za-z]+[。.!?]?)`,
    'gi',
  );

  const match = sentencePattern.exec(detail);
  if (!match) return null;

  const sentence = match[1]!.trim();
  let translationZh = match[2]!.trim();

  // 清理翻译：去掉开头的编号或空格
  translationZh = translationZh.replace(/^[\s\d.]+/, '').trim();

  if (!translationZh) {
    translationZh = translation;
  }

  // 找到目标词在句子中的表层词形
  const surfaceMatch = new RegExp(`\\b(${escapedWord}\\w*)\\b`, 'i').exec(sentence);
  if (!surfaceMatch) return null;

  const surfaceForm = surfaceMatch[1]!;
  const surfaceStart = surfaceMatch.index;
  const surfaceEnd = surfaceStart + surfaceForm.length;

  return {
    sentence,
    translationZh,
    surfaceForm,
    surfaceStart,
    surfaceEnd,
  };
}

/** 解析 exchange 字段获取词形变化。 */
export function parseExchange(exchange: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!exchange) return result;

  const parts = exchange.split('/');
  for (const part of parts) {
    const [type, ...forms] = part.split(':');
    if (type && forms.length > 0) {
      result[type.trim()] = forms
        .join(':')
        .split(',')
        .map((f) => f.trim());
    }
  }
  return result;
}

/** 获取 lemma（优先取 exchange 中的原型，否则用 word 本身）。 */
export function getLemma(word: string, exchange: Record<string, string[]>): string {
  // 0 通常表示原型
  if (exchange['0'] && exchange['0'].length > 0) {
    return exchange['0'][0]!;
  }
  return word;
}
