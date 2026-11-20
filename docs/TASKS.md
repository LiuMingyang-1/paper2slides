# 任务拆解

> 设计依据：`docs/DESIGN.md`。共享契约：`src/types.ts`（数据结构）、`src/anna.ts`（平台接口封装）、`src/prompts/types.ts`（提示词渲染）。
> 规则：每个任务**只改自己负责的目录**；改共享契约必须是新增字段（不删不改），并在交付说明中列出。
> 每个任务在独立分支 `task/Tn-xxx` 上完成，推送后由验收人合并到 `main`。

## 通用要求（所有任务）

- TypeScript strict；`npm run typecheck` 与 `npm test` 必须通过。
- 纯逻辑必须有 vitest 单元测试（依赖浏览器 API 的部分可用 jsdom 或抽出纯函数测试）。
- **不得调用任何会消耗 Anna 额度的接口**，不得执行 `anna-app apps ...` 发布命令。需要 AI 返回时，使用 fake host / fixture。
- 不引入需要访问外部域名的运行时依赖（App CSP 为 `connect-src 'self'`）；所有依赖必须能被 vite 打包进 `bundle/`。
- 交付说明：做了什么、怎么验证的（贴命令输出）、已知限制、对共享契约的改动。

---

## 第一批（并发 3）

### T1 PDF 解析器 — `src/parser/**`, `eval/papers/**`

输入 `ArrayBuffer` → 输出 `Paper`（见 `src/types.ts`）。

1. pdf.js（`pdfjs-dist`）在浏览器 iframe 中运行：worker 必须作为 bundle 内同源文件加载（CSP：`worker-src 'self' blob:`，`script-src 'self'`），不得走 CDN。提供 `parsePdf(buf, opts): Promise<Paper>`。
2. 错误：非 PDF / 加密 / 损坏 / 扫描版（多数页面文字极少）/ 过大 → 抛 `ParseError`（对应 code）。
3. 阅读顺序：基于文字坐标做双栏检测（按 x 分布聚类），栏内按 y 排序；单栏照常。
4. 切块：识别章节标题（编号 + 字号/字重启发式），段落级切块，记录 `sectionPath`、`page`、`bbox`；图注（`Figure N` / `Fig. N` / `Table N` / `图 N` / `表 N` 开头）单独为 `caption`；疑似公式行为 `equation`；过长段落按句切分。evidence id 格式 `e{page}-{index}`。
5. 剔除：页眉页脚（跨页重复的顶部/底部文字）、页码、`References`/`Bibliography`/`参考文献` 之后的内容、致谢；找不到参考文献时给 `REFERENCES_NOT_FOUND` 警告。超过 40 页正文 → 截断 + `TRUNCATED_LONG_DOC`。
6. 元信息：标题（第一页最大字号文字）、作者（尽力）。
7. 图截取：根据 `Figure N` 图注位置，裁剪图注上方区域（到上方最近的正文块），用 canvas 渲染后裁剪为 PNG data URL；双栏按栏宽，跨栏按页宽；失败 `cropOk=false` + 警告。图截取可作为独立函数 `extractFigures(pdfDoc, paper)`，只在浏览器环境运行。
8. 测试：下载 3 篇公开论文 PDF 到 `eval/papers/`（建议：一篇双栏会议论文如 arXiv 1706.03762，一篇单栏，一篇综述），在 Node 下用 pdfjs-dist legacy build 跑解析（不含 canvas 截图），断言：标题正确、参考文献被剔除、证据块数量合理、有 caption 块、页码正确。并输出 `eval/papers/<name>.parsed.json` 供其他任务做 fixture。
9. 提供 `src/parser/README.md` 简述启发式与已知限制。

### T2 检索 + 核验 — `src/retrieval/**`, `src/verify/**`

纯 TypeScript，不依赖浏览器。

1. `src/retrieval/bm25.ts`：BM25（k1=1.2, b=0.75）。分词：英文小写 + 去标点 + 保留数字与带小数/百分号的数（`3.2%` 作为一个 token）+ 保留连字符术语；中文字符 bigram；英文停用词少量。
2. `src/retrieval/vector.ts`：接收 embed 函数（`(texts: string[]) => Promise<number[][]>`），对证据块批量 embedding（批大小可配，结果按 `paperId` 可缓存——提供序列化/反序列化），查询余弦相似度。
3. `src/retrieval/hybrid.ts`：RRF 融合（k=60），实现 `Retriever` 接口；向量不可用（embed 失败）时自动降级为纯 BM25 并记录原因。支持按 `type` / `sectionPath` 过滤。
4. `src/verify/numbers.ts`：从文本提取数字（整数、小数、百分比、带 ± 、科学计数、`k`/`M`/`B` 后缀、中文数字可不做），归一化比较（`3.2%`≈`3.2 %`；`0.032` 与 `3.2%` 视为等价；千分位逗号；尾随 0）。忽略年份、引用编号（如 `[12]`）、章节号、页码、序号（"Figure 3"中的 3）。
5. `src/verify/citation.ts`：`verifyDeck(slides, evidenceById): PointVerification[]`。规则：引用 ID 不存在 → unsupported；要点数字未在**所引证据**中出现 → unsupported；词面支持分（归一化 token 重叠 + 最长公共子串，中英文均可）≥ 阈值 → supported，否则 partial；`opinion` 类型不要求词面支持但仍检查引用存在性与数字；`fact` 无引用 → unsupported；`summary`/`opinion` 无引用 → partial。`reason` 用中文写清原因。阈值做成常量并在测试中说明取值依据。
6. 测试覆盖：中英文、数字等价/不等价、baseline 数字被错引的场景、缺失 ID、空引用。

### T3 AI 调用层 + 提示词 + 生成管线 — `src/llm/**`, `src/schema/**`, `src/pipeline/**`, `prompts/**`

1. `src/llm/client.ts`：封装 `AnnaHost.llm.complete`：渲染提示词（`renderPrompt`）→ 调用 → 解析 JSON（容忍 ```json 代码块包裹、前后多余文字）→ schema 校验 → 失败时把校验错误反馈给模型重试 1 次 → 截断（`stopReason === "maxTokens"`）视为失败可重试 → 网络/超时指数退避（上限 2 次）→ `quota_exceeded` 不重试，抛出带中文说明的错误。每次尝试产生 `LlmCallLog`（含 promptId/version、tokens、`_meta.quotaConsumed`、耗时、stopReason）。`responseFormat` 作为可选开关（默认关，平台待验证）。
2. `src/schema/*.ts`：手写轻量校验器（不引大库也可，或用 zod 若体积可接受），覆盖 Understanding、Outline、Slide 的 LLM 输出；校验 evidenceIds 必须属于给定集合（不存在的保留并交给核验标注，但格式必须正确）；layout 必须是 6 种之一，各 layout 的槽位与字数上限定义放在 `src/schema/layouts.ts`（T4 会复用此定义——这是 T3/T4 的接口，务必清晰）。
3. 提示词（markdown，格式见 DESIGN §5，`npm run prompts` 编译）：
   - `prompts/01-understand.md`：输入整篇论文证据块（`[e3-5] (p.3, §2 Method) 文本` 形式），输出 title、oneLiner、modules（只列论文实际存在的模块，每条 point 带 kind 与 evidenceIds）。
   - `prompts/02-outline.md`：输入 understanding + emphasis + 图列表，输出 5–8 页大纲（首页标题页，缺失模块不出页）。
   - `prompts/03-slide.md`：输入大纲项 + 检索到的证据块 + 版式定义，输出单页 Slide（选 layout、填槽位、遵守字数上限、每条要点带 evidenceIds 与 kind、数字必须照抄原文）。
   - `prompts/04-compress.md`：输入单页 + 超限槽位，输出压缩后的同结构 Slide。
   - `prompts/_shared/citation-rules.md`、`prompts/_shared/output-schema.md`。
   - `prompts/README.md`：总览 + 迭代记录模板（v1 初始）。
   - 输出语言：跟随用户选择（变量 `{{language}}`，zh / en）。
4. `src/pipeline/pipeline.ts`：编排 `understand → outline → slides`（逐页：用 `Retriever` 以 `intent + title` 检索 Top-K=8，并强制包含 understanding 中该模块 points 引用的证据）；整篇论文超长时（按字符数估算超过阈值，常量可配）降级为「按章节分批摘要再理解」。所有步骤结果可通过注入的 cache 接口读写（键：`paperId + promptId@version + 输入哈希`）。接收 `onProgress` 回调。依赖注入：host、retriever、cache，便于测试。
5. 测试：fake host 返回预置 JSON（含错误 JSON、截断、quota_exceeded 场景），验证重试与日志；管线端到端用 fake host 跑通。

---

## 第二批（第一批任一完成后启动）

### T4 版式渲染 + 溢出检测 + PPTX 导出 — `src/layout/**`, `src/export/**`

依赖：`src/schema/layouts.ts`（T3）、`src/types.ts`。

1. 6 种版式的 HTML 模板（固定 1280×720 逻辑尺寸，16:9），一套干净的学术主题（白底、深色正文、单一强调色；遵守 DESIGN 中的排版原则：标题 ≥ 28px 等比、正文下限、0.5 英寸边距、不用装饰色条）。中文字体回退链。
2. 引用角标：每条 point 后渲染 `[n]` 角标（按页内顺序编号），带 `data-evidence-ids` 和核验状态 class（supported/partial/unsupported），供 UI 做气泡与跳转。opinion 类型要点有视觉标识（如「解读」小标签）。
3. 溢出检测：`measureSlide(el)` 找出 `scrollHeight > clientHeight` 的槽位；`fitSlide` 逐级降字号（不低于下限），仍溢出则返回需要压缩/拆页的槽位列表（压缩调用由管线负责，这里只返回结果）。
4. 导出：在 DOM 中渲染每页 → 读取各元素 `getBoundingClientRect()` → 换算为 pptxgenjs 英寸坐标（10×5.625 LAYOUT_16x9）→ 文字、图片、表格写入；页角 `p.N` 页码；完整引文（证据原文 + 页码）写入演讲者备注；返回 PPTX `Blob`。遵守 pptxgenjs 避坑：颜色不带 `#`、每份文件新建实例、不共享 option 对象、bullet 用 `bullet: true`、`isTextBox: true`。
5. 测试：jsdom 下模板渲染快照/结构测试；坐标换算纯函数测试；用 fixture deck 生成 PPTX 并在 Node 下解压校验 XML 结构（slide 数、notes 存在）。

### T5 UI + 状态存储 + 集成 — `src/ui/**`, `src/store/**`, `src/main.ts`

依赖：T1–T4。

1. 流程界面：上传（拖拽 / 选择，校验大小）→ 解析进度与警告 → 理解与大纲确认（可调 emphasis、删除/重排页、改标题）→ 逐页生成进度 → 预览（左侧缩略图、中间幻灯片、右侧 PDF 视图）→ 导出。
2. 引用气泡：悬停角标显示原文片段 + 页码 + 核验状态；点击在右侧 PDF 视图跳到对应页并高亮证据 bbox。
3. 核验面板：每页显示 ✅/⚠️/❌ 统计，可列出所有 ❌ 要点。
4. 溢出闭环：预览渲染后调用 `fitSlide`，仍溢出 → 调用压缩提示词（仅该页）→ 仍溢出 → 拆页。
5. 存储：`src/store/` 基于 `anna.storage`（KV，注意单值大小限制）+ 内存缓存；PDF 本体不入 KV（重开后要求重新上传同一文件，按 sha256 命中缓存）。生成中按钮禁用、防重复调用。
6. 额度展示：生成前预估调用次数；实时显示累计 `quotaConsumed`；调用日志面板可导出 JSON（评测用）。
7. 中英界面切换（默认中文），输出语言选择。
8. standalone（无 host）模式：提供 fixture 演示模式，便于不花额度调试。

### T6 评测 + README — `eval/**`, `README.md`

真实 AI 调用阶段由验收人与用户确认后执行；该任务负责脚手架：评测标注格式、指标计算脚本（读取调用日志与 deck JSON）、README 结构。

---

## 验收清单（验收人执行）

- [ ] 分支只改了负责目录；共享契约改动为纯新增
- [ ] `npm run typecheck && npm test && npm run build && anna-app validate` 通过
- [ ] 抽查关键逻辑与测试是否真的覆盖了 DESIGN 中的边界条件
- [ ] 无外部域名运行时依赖、无额度消耗调用
