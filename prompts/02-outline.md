---
id: outline
version: 1
schema: OutlineSchema
maxTokens: 1536
temperature: 0.2
includes: [_shared/output-schema.md]
---
## 任务

为组会设计 5–8 页顺序清晰的论文汇报。页面标题和意图用 `{{language}}`（zh 中文，en 英文）。

## 输入

侧重点：{{emphasis}}
论文理解：{{understanding}}
可用原图（ID、图号、页码、图注证据 ID）：{{figures}}

## 硬约束

- 第 1 页为标题页，`modules: []`，省略 `figureId`。内容页各有至少一个理解阶段已识别的模块；缺失模块不出页。同一模块可按不同问题拆分。
- `balanced` 按论文贡献分配篇幅；`method` 优先方法；`experiments` 优先实验。所选模块缺失时，在现有模块中安排结构。
- 内容页的 `intent` 写成可检索的短句，包含原文关键术语或数据集名，并明确要解释的问题。标题可本地化；少用宽泛措辞。
- 仅在原图能回答该页问题时写 `figureId`，且必须来自可用原图列表。大纲只安排问题和主题，避免把未经逐页核对的结果数字写进标题。
- `id` 按页序从 `s1` 连续编号。标题最多 150 字符，检索意图最多 200 字符。

## 输出格式

`{"emphasis":"balanced","items":[{"id":"s1","title":"论文标题","modules":[],"intent":"介绍所读论文"},{"id":"s2","title":"研究问题","modules":["problem"],"intent":"说明原文提出的研究问题"}]}`

示例仅展示两个项的结构，实际输出 5–8 项；`emphasis` 原样回填请求值。

## 反例

论文理解只识别出 `taxonomy` 与 `limitations` 时，添加「消融实验」页会引入缺失模块。

{{> _shared/output-schema.md}}
