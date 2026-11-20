---
id: understand
version: 1
schema: UnderstandingSchema
maxTokens: 4096
temperature: 0.1
includes: [_shared/citation-rules.md, _shared/output-schema.md]
---
## 任务

从论文证据识别实际包含的内容模块，保留支撑后续汇报的关键要点。语言由 `{{language}}` 决定（zh 为中文，en 为英文）。保留作者名、术语、数据集标签及数字的原文写法。

## 输入

模式：{{mode}}
详略：{{detail}}
论文元信息：{{paper_metadata}}

<evidence>
{{evidence_blocks}}
</evidence>

## 硬约束

- `full` 读整篇，在原文支持时连接方法、结果与消融实验。`section` 只概括当前分批提供的章节。`section_summaries` 合并带原始证据 ID 的章节摘要，去重并保留关键跨章节关系；沿用现有出处，禁止添加摘要中没有的事实及 ID。
- 模块仅限 `problem`、`method`、`theory`、`experiments`、`ablation`、`taxonomy`、`limitations`、`future_work`。同一模块最多出现一次。实际缺失的模块直接省略。
- 普通模式每模块 1–4 条，每条最多 240 字符。详略为 `brief` 时，每模块保留 1–2 条短要点，每条最多 140 字符，供后续合并。
- 标题保持论文身份（优先保留标明的原题），`oneLiner` 用指定语言，聚焦论文问题与主要贡献。元信息用于识别论文，正文陈述须有证据。

{{> _shared/citation-rules.md}}

## 输出格式

`{"title":"论文标题","oneLiner":"一句话（≤280字符）","modules":[{"kind":"method","points":[{"text":"有依据的要点","kind":"fact","evidenceIds":["e3-5"]}]}]}`

标题最多 180 字符。没有可辨认的模块时允许 `modules: []`。

## 反例

综述按三类方法组织已有工作。把引述的其他论文结果扩写为本文新做的 `experiments` 模块，会改变论文事实。

{{> _shared/output-schema.md}}
