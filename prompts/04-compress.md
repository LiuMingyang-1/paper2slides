---
id: compress
version: 2
schema: SlideSchema
maxTokens: 2048
temperature: 0.1
includes: [_shared/citation-rules.md, _shared/output-schema.md]
---
## 任务

只缩短页面中被标为溢出的槽位，保持 `{{language}}`（zh 中文，en 英文）。原 Slide 是此次改写的内容上限。

## 输入

原 Slide：{{slide}}
溢出的槽位名：{{overflowing_slots}}

## 硬约束

- 保留原 `id`、`outlineId`、`layout`、`figureId`、`notes`、槽位集合、要点数量及顺序。每条的 `kind`、`evidenceIds` 原样保留。其他槽位保持原样。
- 每个标记槽位至少缩短一处文字，其余文字不能增长。先删套话、重复修饰，保留比较对象、实验条件、因果方向、指标归属及必要限定词。
- 数字及单位保持原写法。表格列和关键数字的 `|` 分隔保持不变，数值保留在原单元格。禁止引入原 Slide 未陈述的信息。

{{> _shared/citation-rules.md}}

## 输出格式

输出一份与输入同结构的完整 Slide 对象。

## 反例

BERT 真实输出只列了 MLM 的 80% / 10% / 10%。有机制解释的版本压缩后仍应交代微调输入里没有 [MASK]，这是混合替换策略的动机。

「准确率在测试集 A 为 93.0%」缩成「准确率 93%」会丢失测试条件，并改变日后核验需要的数字写法。

{{> _shared/output-schema.md}}
