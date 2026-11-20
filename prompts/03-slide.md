---
id: slide
version: 4
schema: SlideSchema
maxTokens: 2048
temperature: 0.2
includes: [_shared/citation-rules.md, _shared/output-schema.md]
---
## 任务

围绕大纲项生成一页组会幻灯片。所有内容用 `{{language}}`（zh 中文，en 英文）。论文标题、人名、专名及指标数字可保留原样。

## 输入

大纲项：{{outline_item}}
题目信息：{{paper_metadata}}
本页可用原图（截取成功，含图号、页码、图注原文前 200 字及证据 ID）：{{figures}}
合规版式及槽位上限：{{layouts}}

<evidence>
{{evidence_blocks}}
</evidence>

## 硬约束

- `id` 和 `outlineId` 都等于大纲项 ID。大纲项 `modules: []` 只用 `title` 版式。有模块的页从其余五种版式选择。
- 只有 `bullets_figure` 可带 `figureId`，且必须在顶层填写本页可用图 ID。只有图注描述的内容与该页主题直接相关时才选该版式。大纲规划的图也要复核图注。没有合适原图时用文字版式。禁止输出重绘示意图、图片 URL、HTML 或坐标。
- 只填版式定义的槽位。遵守 `required`、`minItems`、`maxItems` 与 `maxChars`。标点和空格也计字符；要点槽位逐条计数。内容页标题必须是结论句，最多 22 个汉字且总长不超过 60 字符。英文标题最多 60 字符。封面 `title` 原样使用论文标题（最多 180 字符）。中文封面副标题由程序从论文理解填入，请省略 `subtitle`。
- 字符串槽位仅放标题、标签或作者名。事实、结果、比较和有实质内容的图注均用 Point 槽位。所有 `type: "points"` 的槽位均输出 Point 数组。`takeaway` 和 `caption` 若填写，各用只含一条 Point 的数组。每条正文要点先说结论，再补证据支持的原因、机制或关键细节。`takeaway` 写本页最重要的一句话并附出处。
- 给每页写 `notes` 讲稿，2–4 句、最多 300 字符，用口语解释这一页怎么讲、什么值得强调。讲稿中的数字必须出现在本页 Point 已引用的证据中。封面无 Point 引用，讲稿避免写数字。
- 表格用 `|` 分隔 2–4 列，表头与每行列数相同，行与证据中的模型、条件和指标逐一对应。`key_numbers` 的每条 `numbers` 用「数值 | 指标及条件」格式，数值放左边。
- 内容页合计引用至少两个不同的 `evidenceId`。若只有一段证据真正相关，减少要点，只写该段能支撑的结论和解释。不要用无关引文凑数，也不要把同一段拆成多条同义句。

{{> _shared/citation-rules.md}}

## 输出格式

`{"id":"s3","outlineId":"s3","layout":"bullets","slots":{"title":"MLM 让 BERT 同时看左右上下文","bullets":[{"text":"MLM 随机选中部分词元做预测，让模型用左右两侧上下文还原原词。","kind":"summary","evidenceIds":["e2-1","e4-14"]}]},"notes":"讲到遮盖时，可以请大家想象填空题。强调猜词时两边的上下文都可用。"}`

配图页示例。将 `<本页可用图 ID>` 替换为输入中的实际图 ID。

`{"id":"s5","outlineId":"s5","layout":"bullets_figure","figureId":"<本页可用图 ID>","slots":{"title":"BERT 输入叠加三类嵌入","bullets":[{"text":"句段嵌入区分句对中的句 A 和句 B。","kind":"fact","evidenceIds":["e4-2"]}],"takeaway":[{"text":"每个词元的输入叠加词元、句段和位置嵌入。","kind":"summary","evidenceIds":["e5-21"]}],"caption":[{"text":"原图展示同一词元位置上的三层嵌入。","kind":"fact","evidenceIds":["e5-21"]}]},"notes":"对着图看同一个词元的位置。请大家沿着这一列找出词元、句段和位置嵌入。"}`

## 反例

- BERT 真实输出把「方法：双向 Transformer 编码器与 MLM/NSP 预训练任务」写成两行标题。改成「MLM 让 BERT 同时看左右上下文」，把技术细节留给要点。
- 只列 80% / 10% / 10% 讲不清设计目的。应带上 `e4-15` 的解释：微调时没有 [MASK]，所以预训练预测位置保留一部分原词或换成随机词，以缓解两阶段输入不一致。
- 研究问题页四条里三条都引 `e1-5`，是在反复改写单向上下文的局限。若该页只用得到这段，合成一条有解释的要点。
- 讲 MLM/NSP 时用了 Figure 2，但图注只描述 BERT 的输入嵌入。这个主题应选直接解释预训练目标的图，找不到就用文字。
- 备注只写「接下来讲实验」没有讲出本页内容。应先用填空解释 MLM，再点出模型为何能看左右上下文。

{{> _shared/output-schema.md}}
