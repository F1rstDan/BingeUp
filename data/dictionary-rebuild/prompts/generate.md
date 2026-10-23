# 内置词条生成提示 v1

你负责为一批英语单词编写新的学习内容。输入文件是 JSONL，每行一个目标词。只使用输入中的身份与词形元数据；不要读取或复用旧 ECDICT 释义、例句或音标。

## 输出

按输入顺序写出**恰好相同数量**的 JSONL 行。每行一个对象，只包含以下字段：

```json
{
  "wordId": "w-example",
  "word": "example",
  "partOfSpeech": "n.",
  "coreMeaningZh": "例子",
  "secondaryMeanings": [{ "partOfSpeech": "n.", "meaningZh": "范例" }],
  "exampleSentence": "This is a simple example of the rule.",
  "exampleTranslation": "这是这条规则的一个简单例子。",
  "surfaceFormInExample": "example"
}
```

- `wordId` 与 `word` 必须逐字复制输入值，`word` 保持输入大小写。
- `partOfSpeech` 只能取：`n.`、`v.`、`adj.`、`adv.`、`prep.`、`conj.`、`pron.`、`num.`、`art.`、`int.`、`det.`、`abbr.`、`aux.`。
- `coreMeaningZh` 是一个字符串，只表达一个最通用的常见义项，1–24 个字符。不要写词性前缀，不要用逗号、分号或换行拼接其他义项。
- `secondaryMeanings` 为 0–2 项其他常见义项，每项带词性和中文释义；不得重复主释义或彼此重复。没有其他常见义项时写 `[]`。
- `exampleSentence` 是完整、自然、没有空位的英文句子，表达主释义。尽量使用规范词元的原形；如自然语境必须使用屈折形式，使用该形式。
- `surfaceFormInExample` 是目标词在例句中的实际拼写和大小写，必须按整词、忽略大小写恰好出现一次。
- 例句不得包含目标词的另一个屈折形式，避免泄露答案。
- `exampleTranslation` 是准确、自然的中文整句翻译。
- 不要输出音标；音标由固定来源单独合入。
- 不要输出题组、干扰项、自检理由或额外解释。

## 选择义项

优先选择学习者最常遇到的通用义项，不按考试特殊义优先。例句和翻译必须与主释义、主词性一致。无法写出可靠内容时，输出 `{"wordId":"...","error":"具体原因"}`，不要用错误内容凑数。

## 质量要求

- 主释义应简短、具体，避免“某事物的状态”这类空泛描述。
- 例句必须有明确的语境，能体现该义项，而不是只把单词塞进句子。
- 中文翻译不要保留英文词本身代替翻译。
- 不要复制输入之外的旧词库文本。
