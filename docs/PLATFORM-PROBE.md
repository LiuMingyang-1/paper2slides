# 平台实测记录（2026-11-20）

在本地 `anna-app dev`（`--llm real`，连 staging）中，用独立探针 App 实测，结果用于修正 DESIGN.md §12 的待验证事项。

| # | 调用 | 结果 | 额度 |
|---|---|---|---|
| A | `llm.complete`，16 tokens 极短调用 | 正常；模型 `xiaomi/mimo-v2.5`（provider openrouter），927ms | 0.01 |
| B | `llm.complete` + `responseFormat: json_object` | 不报错，但返回仍被 ```json 代码块包裹 → **参数被忽略或不生效** | 0.01 |
| C | `llm.embed` 单条 | 1536 维，`anna-managed-v1`（后端 text-embedding-3-small） | 1.0 |
| D | 整篇 BERT（271 证据块，41k 字符，13.4k 输入 tokens）+ 一句话问答 | 正常，回答正确并引用 `e1-1`，5.1s | **1.63** |
| E | `llm.embed` 一次传 271 条 | **失败**：`too many inputs: 271 > max=64` | 0 |

## 结论与设计修正

1. **整篇输入可行**：13.4k tokens 整篇论文一次放入，模型正常理解。验证了 DESIGN §2.1「单篇论文整篇输入」的判断。
2. **成本很低**：整篇理解约 1.6 额度；按单篇 7–10 次调用估算，**每篇约 5–15 额度**。1000 额度足够完成开发、评测与回归。
3. **`responseFormat` 不可依赖**：保持「提示词约束 + 容错提取 + schema 校验 + 重试」方案（T3 已实现容错提取代码块包裹的 JSON）。
4. **embedding 计费有每次调用的下限（单条即 1 额度）且单次最多 64 条**：
   - 向量检索批大小上限必须 ≤ 64（当前默认 32，符合）。
   - 一篇 271 块论文约需 5–9 次 embed 调用，**向量化成本（5–9 额度）可能高于全部生成调用**。
   - 决策：向量检索改为**可选增强**，默认用 64 条一批以减少调用次数；结果按 paperId 缓存，同一篇论文只向量化一次。BM25 始终可用。
5. 模型由平台决定（当前 `xiaomi/mimo-v2.5`），App 无法指定；提示词不能依赖特定模型能力。

## 副作用

`anna-app dev --llm real` 首次运行时自动在 staging 创建了 App：`[DRAFT] paper2slides (id=288)`，slug 即 `paper2slides`。

本次探针总消耗约 **2.7 额度**。
