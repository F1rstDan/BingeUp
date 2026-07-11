import type { WordBankPort } from '@/learning/learning-service';
import { getDefaultDeck, getBuiltInWord, listBuiltInWords } from '@/dictionary/built-in/decks';

/**
 * 内置词库适配器：将内置示例词库适配为 LearningService 所需的 WordBankPort。
 * Beta 阶段使用项目自建示例数据；后续 Issue 可替换为从 IDB 加载的词库。
 */
export class BuiltInWordBank implements WordBankPort {
  getDefaultDeck() {
    return getDefaultDeck();
  }

  getWord(wordId: string) {
    return getBuiltInWord(wordId);
  }

  listWords() {
    return listBuiltInWords();
  }
}
