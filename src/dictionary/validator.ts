import type { WordRecord, DeckRecord } from '@/types';

/** 校验结果：合法时 errors 为空。 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEmptyEntry(arr: string[]): boolean {
  return arr.some((item) => !isNonEmpty(item));
}

/**
 * 校验单条单词记录（Issue #5 验收标准 1 / Issue #25）。
 * 必须包含：词形、词性、核心中文释义、来源和许可证。
 * 例句和例句翻译为可选（无例句时不能用于语境选择题）。
 * 有例句时必须有例句翻译和 surfaceFormInExample。
 */
export function validateWordRecord(record: WordRecord): ValidationResult {
  const errors: string[] = [];

  if (!isNonEmpty(record.word)) {
    errors.push('word 不能为空');
  }
  if (!isNonEmpty(record.lemma)) {
    errors.push('lemma 不能为空');
  }
  if (!Array.isArray(record.partOfSpeech) || record.partOfSpeech.length === 0) {
    errors.push('partOfSpeech 至少需要一项');
  } else if (hasEmptyEntry(record.partOfSpeech)) {
    errors.push('partOfSpeech 含有空项');
  }
  if (!Array.isArray(record.coreMeaningZh) || record.coreMeaningZh.length === 0) {
    errors.push('coreMeaningZh 至少需要一项');
  } else if (hasEmptyEntry(record.coreMeaningZh)) {
    errors.push('coreMeaningZh 含有空项');
  }
  if (!isNonEmpty(record.source)) {
    errors.push('source 不能为空');
  }
  if (!isNonEmpty(record.license)) {
    errors.push('license 不能为空');
  }
  if (typeof record.difficulty !== 'number' || !(record.difficulty > 0)) {
    errors.push('difficulty 必须为正数');
  }

  // 例句一致性校验：有例句时必须有翻译和表层词形
  if (isNonEmpty(record.exampleSentence)) {
    if (!isNonEmpty(record.exampleTranslation)) {
      errors.push('有例句但无例句翻译');
    }
    if (!isNonEmpty(record.surfaceFormInExample)) {
      errors.push('有例句但无 surfaceFormInExample');
    }
  } else if (isNonEmpty(record.exampleTranslation)) {
    // 有翻译但无例句，不一致
    errors.push('有例句翻译但无例句');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 校验词库记录（Issue #5 验收标准 1）。
 * 必须包含：名称、来源、许可证和至少一个单词。
 */
export function validateDeckRecord(record: DeckRecord): ValidationResult {
  const errors: string[] = [];

  if (!isNonEmpty(record.name)) {
    errors.push('name 不能为空');
  }
  if (!isNonEmpty(record.source)) {
    errors.push('source 不能为空');
  }
  if (!isNonEmpty(record.license)) {
    errors.push('license 不能为空');
  }
  if (!Array.isArray(record.wordIds) || record.wordIds.length === 0) {
    errors.push('wordIds 至少需要一项');
  }

  return { valid: errors.length === 0, errors };
}
