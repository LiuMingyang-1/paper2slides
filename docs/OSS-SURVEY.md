# Paper2Slides 开源组件调研

核查日期为 2026-11-20。以 [项目设计](DESIGN.md) 为约束，目标环境为 Vite + TypeScript 静态 SPA、受限 iframe、`connect-src 'self'`，部署产物上限 50 MB。调研在临时目录完成，未调用 Anna 接口。

npm 表中的日期为所列版本的 UTC 发布日期，周下载为 npm API 返回的 2026-11-12 至 2026-11-18 全版本合计。GitHub-only 项目列仓库 push 或脚本提交日期和 star 数。来源为 [npm registry 元数据](https://registry.npmjs.org/minisearch) 与 [npm Downloads API](https://github.com/npm/registry/blob/main/docs/download-counts.md)，候选表链接可定位各包。

体积以 **KiB 原始 / gzip** 表示。除标明的原始资产外，均使用 esbuild 0.25.12，按 `bundle + minify`、`platform: browser`、`format: esm`、`target: es2022` 打包测量，gzip 级别为 9。各入口使用表中注明的 API，包含实际被打入的传递依赖。50 MB 上限应按完整部署产物核算，gzip 只用于估计传输量。候选表的“ESM”表示发布包有 ESM 入口及本次打包成功，“经打包”表示 CommonJS 或 UMD 能被转换为浏览器 ESM。实际 Anna iframe 兼容性和全量 App 产物体积未核实。单列的 Chrome 实测使用本机 HTTP 和同源 CSP。

## 1. BM25 / 全文检索

**替换。** 用 MiniSearch 接管 [BM25 索引及打分](../src/retrieval/bm25.ts)，保留项目的 `tokenize`、证据过滤和并列时按 ID 排序。索引和查询共用同一 tokenizer，`processTerm` 原样返回，关闭模糊和前缀匹配。把类型和章节前缀作为结果过滤条件，稳定排序后再截取 Top-K。临时探针复用仓库的三个证据块，六种查询与现有实现返回相同的证据 ID 和顺序，覆盖中文、百分比、章节过滤、无命中与 K=0。MiniSearch 使用 BM25+，评分及排序可能改变，迁移应以论文样本的证据 Top-K 和 RRF 结果验收；全语料排名回归未核实。 [MiniSearch API](https://lucaong.github.io/minisearch/) · [源码](https://github.com/lucaong/minisearch)

| 候选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及取舍 |
| --- | --- | --- | --- | --- |
| [minisearch](https://www.npmjs.com/package/minisearch) | 7.2.0 · 2025-09-16 · 6,438,165 | MIT | 17.2 / 5.7 | ESM。提供 `tokenize`、`processTerm`、`filter`。 |
| [wink-bm25-text-search](https://github.com/winkjs/wink-bm25-text-search) | 3.1.2 · 2022-11-21 · 81,968 | MIT | 10.1 / 3.5 | CommonJS，经打包。BM25F 的 `definePrepTasks` 能接自定义分词，测量只导入搜索核心。索引需先 consolidate，发布较久，单证据块场景需额外兼容。 |
| [@orama/orama](https://github.com/oramasearch/orama) | 3.1.18 · 2025-12-19 · 2,057,333 | Apache-2.0 | 63.8 / 21.8 | ESM，测 `create/insertMultiple/search`。支持 BM25 全文检索、自定义 tokenizer 和过滤，适合需要统一全文与向量检索时评估。 |
| [flexsearch](https://github.com/nextapps-de/flexsearch) | 0.8.212 · 2025-09-06 · 1,294,047 | Apache-2.0 | 49.3 / 16.9 | ESM，测 `Index/Encoder`。有 CJK encoder 和自定义 encoder，采用自己的排序逻辑。更适合独立的全文搜索 UI。 |

## 2. JSON schema 校验

**替换。** 用 Valibot 表达 [现有校验器](../src/schema/validation.ts) 的对象结构、枚举、数组边界和字段约束，保留 Unicode code point 长度、动态槽位上限、唯一证据 ID，以及跨字段规则。用 `strictObject` 拒绝多余字段，用 `safeParse` 汇总问题，格式化为字段路径和简短中文原因，例如 `points[0].evidenceIds[0]：应为 e{页码}-{块序号}`。探针已验证 `getDotPath(issue)` 返回带数组下标的路径。继续把格式合法但不存在的 ID 放在 `missingEvidenceIds`，供预览标注。发送给模型的反馈只带少量路径和规则，避免附上输入值。 [Valibot getDotPath](https://valibot.dev/api/getDotPath/) · [strictObject](https://valibot.dev/api/strictObject/)

| 候选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及错误输出 |
| --- | --- | --- | --- | --- |
| [valibot](https://www.npmjs.com/package/valibot) | 1.5.0 · 2026-09-09 · 35,812,700 | MIT | 5.2 / 1.8 | ESM。按需导入，`issues` 给出路径、消息，可定制中文。 |
| [zod](https://www.npmjs.com/package/zod) | 4.6.7 · 2026-10-12 · 475,873,286 | MIT | 83.6 / 24.7 | ESM，测标准入口。支持 `issues` 和 `prettifyError`，适合直接生成多行反馈。 [错误格式文档](https://zod.dev/error-formatting) |
| [ajv](https://www.npmjs.com/package/ajv) | 8.20.0 · 2026-04-24 · 548,918,945 | MIT | 121.6 / 37.5，预编译样例 6.0 / 1.5 | CommonJS 经打包。错误有 `instancePath`、`keyword`、`message` 和 `params`。运行时编译依赖动态代码生成，严格 `script-src` 下应在构建期生成 standalone ESM。适合已有标准 JSON Schema 的场景。 [CSP 说明](https://ajv.js.org/security.html) · [standalone](https://ajv.js.org/standalone.html) |

体积用同类样例测得，含嵌套对象、枚举、字符串长度、ID 正则和数组约束。Zod、Valibot 样例用自定义检查实现去重，Ajv 用 `uniqueItems`。这些数字仅覆盖样例验证器。

## 3. LLM 输出 JSON 容错

**保留手写。** [当前解析器](../src/llm/client.ts) 支持严格 JSON、围栏和从说明文字中提取完整根值，已单独检测输出截断并以错误反馈重试。两款库都能处理尾逗号，探针也发现两者都将残缺的 `{"score":1e` 解析为数值 1，数值字段的 schema 可能照样通过。现阶段保持完整值校验；若以后有大量可恢复的语法错误，用 jsonrepair 做受限的语法容错实验。若新增流式预览，partial-json 可显示临时内容，最终结果仍走完整值校验。 [jsonrepair 支持的修复](https://github.com/josdejong/jsonrepair#readme) · [partial-json 选项](https://github.com/promplate/partial-json-parser-js#readme)

| 备选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器 |
| --- | --- | --- | --- | --- |
| [jsonrepair](https://www.npmjs.com/package/jsonrepair) | 3.15.0 · 2026-07-03 · 6,290,488 | ISC | 7.6 / 2.9 | ESM，测普通 `jsonrepair` API。 |
| [partial-json](https://www.npmjs.com/package/partial-json) | 0.1.7 · 2024-05-14 · 17,130,826 | MIT | 4.3 / 1.7 | CommonJS，经打包。测 `parse/Allow`。 |

## 4. 中文分词

**保留手写。** 现有 Han bigram 兼顾专名子串召回，并和英文模型名、带符号数值、百分比共用归一化。它也参与引文核验，更换后须重新评估召回与核验阈值。有中文论文样本后，优先把 `Intl.Segmenter` 作为对照，用 `new Intl.Segmenter('zh', { granularity: 'word' })` 获取词，按 `isWordLike` 筛选。可只替换 Han 段，继续用现有规则处理数字和型号。Chrome 探针把“中文论文”分成“中文”和“论文”，其术语召回收益未核实。 [ECMA-402 规范](https://tc39.es/ecma402/#segmenter-objects) · [MDN 兼容性](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)

| 备选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器 |
| --- | --- | --- | --- | --- |
| `Intl.Segmenter` | 浏览器内置，版本、发布日期、下载量不适用。MDN Baseline 2024 | npm 许可证不适用 | 0 / 0 | 在 ESM 中直接调用，可特性检测后回退到 bigram。 |
| [jieba-wasm](https://github.com/fengkx/jieba-wasm) | 2.4.0 · 2025-09-16 · 45,774 | MIT | JS 4.6 / 1.9，WASM 3,921.0 / 2,757.2 | `jieba-wasm/web` 为浏览器 ESM，测初始化和 `cut/cut_for_search`。WASM 需作为同源资源发布，实际 iframe 是否允许编译 WASM 未核实。词典与搜索模式适合有明确分词收益时使用。 |

## 5. 引用悬停气泡

**新引入。** 采用 `@floating-ui/dom` 负责定位、边界翻转、平移和滚动时更新，原生 TS 处理引用语义和交互。引用用按钮，悬停和键盘聚焦时显示证据摘要，点击跳转，Esc 关闭；锚点可用 `aria-describedby` 关联只读气泡。监听仅在显示时启用，关闭时调用 `autoUpdate` 返回的清理函数。若气泡内部有可操作控件，按 popover 处理焦点。 [Floating UI 定位和清理](https://floating-ui.com/docs/autoupdate) · [WAI-ARIA Tooltip](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)

| 候选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及取舍 |
| --- | --- | --- | --- | --- |
| [@floating-ui/dom](https://www.npmjs.com/package/@floating-ui/dom) | 1.8.0 · 2026-07-11 · 149,016,288 | MIT | 15.5 / 6.3 | ESM，测 `computePosition/autoUpdate/offset/flip/shift`。 |
| [tippy.js](https://github.com/atomiks/tippyjs) | 6.3.7 · 2021-11-10 · 8,851,216 | MIT | 36.4 / 12.9，含 Popper 与 CSS | ESM。提供成品触发器、主题和动画，GitHub 仓库已归档。 |

## 6. App 内 PDF 查看器与 UI 框架

**新引入。** 从现有 `pdfjs-dist@4.10.38` 引入 `web/pdf_viewer.mjs` 和样式，用 `PDFViewer`、`PDFLinkService`、`EventBus`。在加载 viewer 前先初始化同版本的 PDF.js runtime，4.10.38 的 viewer 模块读取 `globalThis.pdfjsLib`。复用 [解析器](../src/parser/index.ts) 的同源 worker、CMap 和标准字体，避免替换 worker 版本或再装一份 PDF.js。用 1-based 页码调用 `scrollPageIntoView`，使用 `getPageView(page - 1).viewport.convertToViewportRectangle(bbox)` 投影现有 PDF 用户坐标。多栏页面可按需用 PDF 坐标指定 `XYZ` 跳转到区域。高亮使用页面内覆盖层，在 `pagerendered` 时重挂载和重算，因为页视图重置会移除覆盖层。Chrome 157 在同源 CSP 下加载仓库的 BERT PDF，实测跳到第 2 页，缩放并旋转后覆盖层重新挂载、坐标更新，未观察到跨源请求。 [4.10.38 viewer 源码](https://github.com/mozilla/pdf.js/blob/v4.10.38/web/pdf_viewer.js)

| 候选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及取舍 |
| --- | --- | --- | --- | --- |
| [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) viewer | 4.10.38 · 2025-01-01 · 61,873,531。包最新 6.5.438，2026-11-01 | Apache-2.0 | viewer 增量 244.0 / 66.8，含 CSS、SVG、GIF。现有 runtime 323.5 / 95.3，worker 1,279.7 / 391.0，字体与 CMap 另计 | ESM，无框架要求，跳页由 viewer 提供，bbox 覆盖层由 App 实现。 |
| [react-pdf-highlighter](https://github.com/agentcooper/react-pdf-highlighter) | 8.0.0-rc.0 · 2024-09-14 · 58,135 | MIT | 286.1 / 79.9，含 CSS，排除 React 与 PDF.js 依赖 | ESM。可用 `scrollRef` 跳到 highlight，支持文本和区域高亮。依赖 React/ReactDOM ≥18，并固定 PDF.js 4.4.168，默认和项目 4.10.38 并存。 |
| [PDFSlick](https://github.com/pdfslick/pdfslick) | core/react 4.0.3 · 2026-10-09 · 28,645 / 22,805 | MIT | core 46.4 / 15.1，React 包 5.1 / 2.2，共用发布 CSS 216.5 / 45.1。排除 PDF.js、React，React 包另排除 core | ESM。有原生 JS core 和 React 绑定，`gotoPage`、`getPageView` 可接自定义覆盖层。core 依赖 PDF.js ^6.0.227，独立 bbox 高亮 API 未核实。 |

**整套 UI 选原生 TS。** PDF viewer 和气泡都能直接接入，固定版式可继续用 HTML/CSS 模板。若后续大纲编辑演变成多个共享状态的交互面板，Preact 是较轻的组件化方案。若明确需要 React 生态中的 PDF 组件，React 能直接满足 peer 依赖；Preact 的 `compat` 需要配置别名，PDF 组件的兼容性未核实。 [Preact 兼容指南](https://preactjs.com/guide/v10/switching-to-preact/) · [React createRoot](https://react.dev/reference/react-dom/client/createRoot)

| 框架 | 版本 · 日期 · 周下载 | License | 浏览器打包体积 |
| --- | --- | --- | --- |
| [preact](https://www.npmjs.com/package/preact) | 11.2.0 · 2026-11-06 · 62,748,647 | MIT | ESM，核心渲染与两个 hooks 13.0 / 5.5。单独测 `compat` 及其 client 入口为 23.6 / 9.4。 |
| [react](https://www.npmjs.com/package/react) + [react-dom](https://www.npmjs.com/package/react-dom) | 均为 19.3.1 · 2026-10-14 · 273,970,923 / 258,598,987 | MIT | CommonJS，经打包。生产入口含 `createRoot` 和两个 hooks 共 216.7 / 67.2。 |

## 7. HTML / DOM 转 PPTX

**保留手写。** 导出层按 [六个固定学术版式](DESIGN.md#26-排版模型选版式填内容代码负责摆放) 实现窄接口：读取已渲染槽位相对幻灯片根节点的矩形，按画布和目标版面的宽高比例换算英寸，再用现有 PptxGenJS 写可编辑文字、表格、形状、图片和备注。DOM 层负责测量，版式层明确元素语义。这样能直接控制文本框内边距、表格单元、导出备注与溢出降级。跨 PowerPoint、Keynote 的字体与换行一致性未核实。 [PptxGenJS](https://github.com/gitbrent/PptxGenJS)

首选现成备选为 `dom-to-pptx`。其浏览器入口会读取 DOM 和计算样式，内部创建 PptxGenJS 实例，直接输出 PPTX Blob。Chrome 157 同源 CSP 实测导出单页，解包确认中文和百分比写入可编辑文本节点，未观察到跨源请求。实际六种版式、备注、字体和表格保真度未核实。库会尝试发现并下载 CSS 字体，使用它时应把字体、图片与 CSS 固定为本地或同源资源；`./node` 子入口依赖 Puppeteer，浏览器打包失败。 [浏览器 API 与字体选项](https://github.com/atharva9167j/dom-to-pptx)

| 路线 | 版本 · 日期 · 活跃度 | License | 体积 | 浏览器 |
| --- | --- | --- | --- | --- |
| [pptxgenjs](https://www.npmjs.com/package/pptxgenjs) | 4.0.1 · 2025-06-26 · 7,123,191 周下载 | MIT | 364.6 / 123.2 | ESM，现有依赖，测默认导出。 |
| [dom-to-pptx](https://www.npmjs.com/package/dom-to-pptx) | 2.1.2 · 2026-09-14 · 232,542 周下载 | MIT | 2,188.97 / 776.6，含 PptxGenJS 等依赖 | 浏览器 ESM。对任意 HTML 导入需求更有价值。 |
| [GX-Alex/html2pptx](https://github.com/GX-Alex/html2pptx) | 2026-06-08 仓库 push · 11 stars | MIT | 浏览器产物未核实 | Python CLI 调 Chromium 做 DOM/SVG 提取，再生成 DrawingML，整条链路无法在静态 iframe 运行。 |
| [Anthropic 历史 html2pptx](https://github.com/anthropics/skills/blob/ef740771ac901e03fbca3ce4e1c453a96010f30a/skills/pptx/scripts/html2pptx.js) | 2026-02-04 从 skill 移除 · skills 仓库 197,830 stars，脚本单独数据未核实 | 专有，历史目录有独立 LICENSE | 浏览器产物未核实 | 脚本使用 Node CommonJS、Playwright、`path`、`sharp`，不能直接在浏览器复用。当前 skill 改为直接编写 PptxGenJS 脚本。 [移除提交](https://github.com/anthropics/skills/commit/4e6907a33c3c0c9ce7c1836980546aaba78a34b5) · [历史许可证](https://github.com/anthropics/skills/blob/ef740771ac901e03fbca3ce4e1c453a96010f30a/skills/pptx/LICENSE.txt) · [当前 skill](https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md) |

## 8. 文本适配 / 字号自动缩放

**保留手写。** 对固定 16:9 槽位，在字体就绪后测量宽高，按既定字号档位递减，保留正文 14 pt、注释 10 pt 的下限。到下限仍溢出时，让现有排版流程决定压缩或拆页，并把实际字号交给导出。正文里有嵌套文本、引用角标、列表和表格，App 需要按整槽位测量。两款库适合单块文本，跨六种版式的表现未核实。 [排版设计](DESIGN.md#26-排版模型选版式填内容代码负责摆放)

| 备选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及取舍 |
| --- | --- | --- | --- | --- |
| [fitty](https://github.com/rikschennink/fitty) | 2.4.2 · 2023-11-17 · 261,818 | MIT | 3.4 / 1.3 | ESM。有 `minSize/maxSize`，按容器宽度缩放，适合单行标题或大号数字。 |
| [textfit](https://github.com/STRML/textFit) | 2.4.0 · 2019-06-18 · 19,664 | MIT | 3.7 / 1.6 | UMD，经打包。支持固定容器宽高和多行，但通过 `innerHTML` 重建内容并添加 wrapper，结构化引用的交互需另适配。 |

## 9. 模糊匹配与最长公共子串

**保留手写。** [现有核验](../src/verify/citation.ts) 在指定证据块内对比归一化 token，分数结合 token 重叠与最长连续 token 片段，并单独核对数值及其归属。最长连续片段的滚动 DP 使用 O(要点 tokens × 证据 tokens) 时间、O(要点 tokens) 空间，适合少量短文本。在检索阶段做模糊候选排序可以使用 Fuse，在已经指定证据的核验阶段，两个候选都无法保持现有分数的解释和边界。 [Fuse 源码](https://github.com/krisk/Fuse) · [Dice 实现](https://github.com/aceakash/string-similarity)

| 备选 | 版本 · 日期 · 周下载 | License | 体积 | 浏览器及取舍 |
| --- | --- | --- | --- | --- |
| [fuse.js](https://www.npmjs.com/package/fuse.js) | 7.5.0 · 2026-07-13 · 20,797,449 | Apache-2.0 | 25.9 / 9.4 | ESM，测默认入口。Bitap 模糊检索适合未知证据候选的排序，不提供连续 token 子串长度。 |
| [string-similarity](https://www.npmjs.com/package/string-similarity) | 4.0.4 · 2021-01-06 · 3,191,055 | ISC | 1.4 / 0.7 | CommonJS，经打包。字符二元组 Dice 相似度会丢失更长的连续片段信息，npm 已标记 deprecated。 |

## 建议依赖清单

| 用途 | npm 包和验证版本 | 建议 |
| --- | --- | --- |
| 全文检索 | `minisearch@7.2.0` | 新增，接现有 tokenizer 与过滤，迁移前核对证据 Top-K。 |
| Schema 校验 | `valibot@1.5.0` | 新增，把结构校验与中文反馈接入现有校验器接口。 |
| 引用气泡 | `@floating-ui/dom@1.8.0` | 新增，负责定位和更新。 |
| PDF 渲染和查看器 | `pdfjs-dist@4.10.38` | 复用当前版本，启用包内 viewer、样式与图标，复用同源 worker。 |
| PPTX 生成 | `pptxgenjs@4.0.1` | 复用当前版本，按槽位测量结果生成原生 PPTX 元素。 |

新增三包的独立探针合计约 37.9 KiB 原始 / 13.8 KiB gzip，另有现有 PDF.js 的 viewer 增量约 244.0 / 66.8 KiB。实际部署产物仍需在 UI 集成后测量。所有建议都可在构建时打包，运行时从同源加载资源。

## 迁移验证

### 检索

用 `eval/papers/*.parsed.json` 的 738 个证据块做离线双跑。每篇预先选 10 条英文查询，覆盖数字、术语和自然语言意图。按证据 ID 集合比较前八项。overlap@8 是交集大小除以旧结果数，旧结果不足 8 时按实际长度计。默认试跑使用同一分词器、关闭模糊及前缀匹配，并按原规则稳定排序。

| 论文 | 查询数 | MiniSearch 默认平均 | 默认低于 0.75 | 迁移后平均 | 前八项顺序完全一致 |
| --- | ---: | ---: | ---: | ---: | ---: |
| BERT | 10 | 0.8875 | 0 | 1.000 | 10/10 |
| Visualization | 10 | 0.9500 | 1 | 1.000 | 10/10 |
| Deep Learning Review | 10 | 0.7125 | 5 | 1.000 | 10/10 |
| 合计 | 30 | 0.8500 | 6 | 1.000 | 30/30 |

| 论文 | 查询 | 默认 overlap@8 | 迁移后 |
| --- | --- | ---: | ---: |
| BERT | `80.5% GLUE improvement` | 0.875 | 1.000 |
| BERT | `93.2 SQuAD 1.1 F1` | 0.875 | 1.000 |
| BERT | `1024 hidden size 16 attention heads` | 0.875 | 1.000 |
| BERT | `masked language model` | 0.875 | 1.000 |
| BERT | `next sentence prediction` | 1.000 | 1.000 |
| BERT | `WordPiece embeddings` | 1.000 | 1.000 |
| BERT | `bidirectional Transformer encoder` | 0.750 | 1.000 |
| BERT | `why train with a masking objective` | 1.000 | 1.000 |
| BERT | `does the benefit depend on model size` | 0.875 | 1.000 |
| BERT | `how to adapt pretrained weights to downstream tasks` | 0.750 | 1.000 |
| Visualization | `10 simple rules` | 1.000 | 1.000 |
| Visualization | `6 non-mutually exclusive categories collaborators` | 1.000 | 1.000 |
| Visualization | `Venn diagrams up to 3 sets` | 1.000 | 1.000 |
| Visualization | `JBrowse Ensembl IGV` | 1.000 | 1.000 |
| Visualization | `UpSet intersections` | 1.000 | 1.000 |
| Visualization | `Datasaurus visual encoding` | 1.000 | 1.000 |
| Visualization | `WebGL browser rendering` | 1.000 | 1.000 |
| Visualization | `how to decide whether to build a new tool` | 0.875 | 1.000 |
| Visualization | `why test on both simulated and real data` | 1.000 | 1.000 |
| Visualization | `how to keep a tool useful after release` | 0.625 | 1.000 |
| Deep Learning Review | `Table 2 22–74 deep learning models` | 0.625 | 1.000 |
| Deep Learning Review | `Table 7 instance feature model parameter` | 0.750 | 1.000 |
| Deep Learning Review | `Table 8 77–143 federated centralized` | 0.625 | 1.000 |
| Deep Learning Review | `convolutional neural network CNN` | 0.500 | 1.000 |
| Deep Learning Review | `deep belief network restricted Boltzmann machine` | 0.625 | 1.000 |
| Deep Learning Review | `deep Q-network reinforcement learning` | 0.750 | 1.000 |
| Deep Learning Review | `vertical horizontal federated learning` | 1.000 | 1.000 |
| Deep Learning Review | `how to learn when all data cannot be stored in memory` | 0.875 | 1.000 |
| Deep Learning Review | `why transfer knowledge to a different task` | 0.500 | 1.000 |
| Deep Learning Review | `privacy and communication challenges across clients` | 0.875 | 1.000 |

逐条复核默认试跑中低于 0.75 的证据交换。

| 查询 | 默认结果判读 |
| --- | --- |
| `how to keep a tool useful after release` | 变差。新增的 `e5-5` 提供了技术过时后的改造案例，但关于数据规模的 `e6-5` 占据前八，直接说明发布后持续开发和支持的 `e1-36` 掉出。 |
| `Table 2 22–74 deep learning models` | 改善。表题 `e5-1` 保持第一，DBN、AE、GAN 三段正文进入前八，替代了表 3、表 4、表 5 的表题。 |
| `Table 8 77–143 federated centralized` | 变差。表题 `e17-1` 保持第一，`e16-24` 补充了横向和纵向联邦学习的通信对比，但两段综述背景 `e1-11` 和 `e3-3` 也挤入前八，章节标记 `e16-14`、`e16-18` 和横向对比片段 `e17-7` 掉出。 |
| `convolutional neural network CNN` | 改善。CNN 的定义和结构说明 `e4-10` 进入前八，掉出的结果包括仅讲浅层网络或 RNN 的 `e5-4`、`e5-7`。 |
| `deep belief network restricted Boltzmann machine` | 改善。解释 RBM 结构与 DBN 训练的 `e7-17` 从第 4 升到第 1，解释 DBN 训练细节的 `e8-19` 进入前八，替代了部分只有模型名称的表格条目。 |
| `why transfer knowledge to a different task` | 改善。直接解释标注数据稀缺、训练成本和算力收益的 `e12-24` 进入前八，掉出的结果包括单独图题 `e13-1` 和在线学习表格片段 `e12-7`。 |

为保持检索接口的评分及排序约定，最终版采用 MiniSearch 的 `k=1.2`、`b=0.75`、`d=0`，在索引时按实际 token 出现次数计文档长度，查询词去重，并去掉库对匹配词数量的乘数。两条退化查询恢复原 Top-8，另外四条也按同一规则恢复原顺序。旧打分仅保留在测试目录，30 条查询继续逐项检查有序证据 ID。测试还覆盖中文 bigram、数值 token、类型和章节过滤、同分按 ID 排序，以及用本地 mock 验证的 RRF 和向量失败回退。全程未调用 Anna。

### Schema

Valibot 承担对象、枚举、数组、Unicode 长度、证据 ID 格式和去重校验，跨字段约束继续按业务规则执行。失败仍抛出 `SchemaError`，给重试提示最多三条「字段路径＋中文原因」。新测试覆盖嵌套数组路径、缺字段、额外字段和 Unicode 长度边界。返回值继续提供 `value` 和 `missingEvidenceIds`，版式定义文件保持原样。

### 构建体积

同一环境运行 `npm run build`，下表使用 Vite 6.4.6 输出的 kB。当前 SPA 入口仍是 T5 占位页，两次正式构建都只包含占位代码。组件探针在前后构建使用同一个临时入口，把 `HybridRetriever` 和四个校验函数挂到 `globalThis`，以保留组件参与打包。测量后恢复入口。

| JS 产物 | 替换前 kB / gzip | 替换后 kB / gzip | 增量 kB / gzip |
| --- | ---: | ---: | ---: |
| 当前 SPA 入口 | 1.05 / 0.59 | 1.05 / 0.59 | 0 / 0 |
| 检索与校验组件探针 | 12.36 / 5.60 | 35.96 / 12.93 | +23.60 / +7.33 |
