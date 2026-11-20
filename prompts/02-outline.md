---
id: outline
version: 2
schema: OutlineSchema
maxTokens: 1536
temperature: 0.2
includes: [_shared/output-schema.md]
---
## 任务

为组会设计 6–10 页顺序清晰的论文汇报。页面标题和意图用 `{{language}}`（zh 中文，en 英文）。

## 输入

侧重点：{{emphasis}}
论文理解：{{understanding}}
可用原图（ID、图号、页码、图注原文前 200 字及证据 ID）：{{figures}}

## 硬约束

- 第 1 页为标题页，`modules: []`，省略 `figureId`。内容页各有至少一个理解阶段已识别的模块；缺失模块不出页。同一模块可按不同问题拆分。
- `balanced` 按论文贡献分配篇幅；`method` 优先方法；`experiments` 优先实验。所选模块缺失时，在现有模块中安排结构。
- 内容页的 `intent` 写成可检索的短句，包含原文关键术语或数据集名，并明确要解释的问题。每个内容页的 `title` 要写出该页能解释的具体结论。整份大纲标题不能重复，不能用「方法」「消融」等模块名作标题。
- 仅在图注描述的内容与本页结论直接相关、图能帮助回答该页问题时写 `figureId`，且必须来自可用原图列表。大纲只安排问题和主题，避免把未经逐页核对的结果数字写进标题。
- `id` 按页序从 `s1` 连续编号。标题最多 150 字符，检索意图最多 200 字符。

## 输出格式

`{"emphasis":"balanced","items":[{"id":"s1","title":"论文标题","modules":[],"intent":"介绍所读论文"},{"id":"s2","title":"单向预训练限制上下文","modules":["problem"],"intent":"解释 left-to-right 预训练丢失哪些上下文及其对问答的影响"}]}`

示例仅展示两个项的结构，实际输出 6–10 项；`emphasis` 原样回填请求值。

## 反例

BERT 的大纲曾连续出现「方法」「方法」「消融」「消融」。双向预训练机制与输入表示应写成不同结论，例如「MLM 让 BERT 同时看左右上下文」和「BERT 把词元、句段和位置编码相加」。Figure 2 的图注只描述输入表示，不能把它分配给讲 MLM/NSP 的页。

论文理解只识别出 `taxonomy` 与 `limitations` 时，添加「消融实验」页会引入缺失模块。

{{> _shared/output-schema.md}}
