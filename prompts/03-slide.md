---
id: slide
version: 1
schema: SlideSchema
maxTokens: 1536
temperature: 0.2
includes: [_shared/citation-rules.md, _shared/output-schema.md]
---
## 任务

围绕大纲项生成一页组会幻灯片。所有内容用 `{{language}}`（zh 中文，en 英文）。论文标题、人名、专名及指标数字可保留原样。

## 输入

大纲项：{{outline_item}}
题目信息：{{paper_metadata}}
本页可用原图（截取成功且图注已提供）：{{figures}}
合规版式及槽位上限：{{layouts}}

<evidence>
{{evidence_blocks}}
</evidence>

## 硬约束

- `id` 和 `outlineId` 都等于大纲项 ID。大纲项 `modules: []` 只用 `title` 版式。有模块的页从其余五种版式选择。
- 只有 `bullets_figure` 可带 `figureId`，且必填本页可用图 ID。框架图也用该版式。没有可用原图时，按内容选文字版式；禁止输出重绘示意图、图片 URL、HTML 或坐标。
- 只填版式定义的槽位。遵守 `required`、`minItems`、`maxItems` 与 `maxChars`。标点和空格也计字符；要点槽位逐条计数。优先保留支撑本页意图的短要点。
- 字符串槽位仅放标题、标签或作者名。事实、结果、比较和有实质内容的图注均用 Point 槽位。可选 `notes` 最多 240 字符，只写过渡提示。
- 表格用 `|` 分隔 2–4 列，表头与每行列数相同，行与证据中的模型、条件和指标逐一对应。`key_numbers` 的每条 `numbers` 用「数值 | 指标及条件」格式，数值放左边。
- 相关证据不足时，选择 `bullets`，只保留现有证据已支持的内容。没有可引用的证据就不生成虚构的事实。

{{> _shared/citation-rules.md}}

## 输出格式

`{"id":"s2","outlineId":"s2","layout":"bullets","slots":{"title":"主要方法","bullets":[{"text":"有证据的短要点","kind":"fact","evidenceIds":["e3-5"]}]}}`

## 反例

图已裁剪失败仍写 `figureId`，或将「提升 3.26%」写进字符串标题且无引用，都无法追溯。

{{> _shared/output-schema.md}}
