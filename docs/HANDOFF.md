# 交接文档（截至 2026-11-20 晚）

> 给明天接手的人（包括新会话的 Claude）。当天的决策与问题见 [LOG-2026-11-20.md](LOG-2026-11-20.md)，设计见 [DESIGN.md](DESIGN.md)。

## 1. 一句话现状

主流程代码全部完成并合入 `main`（`e39387f`，168 个测试全绿）。**真实模型端到端还没有完整跑通过一次**：已修复 6 个真实模型输出问题，最后一次停在封面标题长度（已修，未重跑）。

## 2. 环境与入口

| 项 | 值 |
|---|---|
| 本地路径 | `/Users/lmy/Documents/code/Anna/paper2slides` |
| 仓库 | 私有 `LiuMingyang-1/paper2slides`，分支 `main` |
| Anna 账号 | staging，已开通开发者，`anna-app login` 已登录（PAT 约 90 天） |
| Anna App | `[DRAFT] paper2slides (id=288)`，slug `paper2slides`（不可改） |
| 平台模型 | `xiaomi/mimo-v2.5`（平台分配，App 不能改） |
| 额度 | 已用约 18.5 / 1000 |

```bash
npm install
npm test                       # 168 个测试
npm run build                  # 编译提示词 + 类型检查 + 打包到 bundle/
anna-app validate
npm run dev:web                # 纯前端，http://localhost:5173/  ——「试用 BERT Demo」零额度
#   版式预览：http://localhost:5173/src/layout/preview.html
npm run build && anna-app dev --port 5182 --no-watch   # 本地 harness，连真实 AI（会扣额度）
```

## 3. 代码地图

| 目录 | 内容 | 关键点 |
|---|---|---|
| `src/parser/` | pdf.js 解析、切块、剔除参考文献、截图 | worker 同源打包；`eval/papers/*.parsed.json` 是 3 篇论文的解析结果 |
| `src/retrieval/` | MiniSearch BM25、向量、RRF | 向量默认关，每批 64 |
| `src/verify/` | 引文/数字核验、跨语言锚点、数词 | 核心卖点 |
| `src/llm/` | 调用、重试、容错解析、重复键、补括号 | `fixtures/` 是真实模型原始输出；`real-output.test.ts` 是回归 |
| `src/schema/` | Valibot 校验 + 归一化 | `layouts.ts` 是内容与版式之间的契约 |
| `src/pipeline/` | understand → outline → slides，缓存 | 缓存键含提示词版本：**改提示词会使对应步骤缓存失效** |
| `src/layout/`, `src/export/` | 6 种版式、自适应、PPTX 导出 | 预览与导出共用测量 |
| `src/ui/`, `src/store/` | 三栏 UI、气泡、核验面板、Demo | Demo 数据在 `src/ui/demo/` |
| `prompts/` | 4 个提示词 + 迭代记录 | 当前版本：understand@2、outline@2、slide@3、compress@1（以 frontmatter 为准） |
| `eval/runs/2026-11-20/` | 当天真实运行的调用日志与截图 | `run3-s*.png` 是旧提示词效果 |

## 4. 明天待办（按顺序）

### 4.1 跑通 BERT 端到端（最优先，约 3–6 额度）
1. 启动 harness：`npm run build && anna-app dev --port 5182 --no-watch`
2. 用自动化脚本跑（见 §6），或在浏览器打开 `http://localhost:5182/` 手动操作：上传 `eval/papers/bert.pdf` → 理解并生成大纲 → 生成幻灯片 → 导出 PPTX。
   - 注意：harness 是内存缓存，**重启后之前的理解/大纲缓存会丢失**，需要重新理解（约 2.8 额度）。
3. **若某步失败**：打开"调用日志"导出 JSON，看 `rawOutput` 与 `normalizations`；把原始输出存入 `src/llm/fixtures/`，在 `real-output.test.ts` 补回归测试再修。这一流程今天已经用了 6 次。
4. 成功后与 `eval/runs/2026-11-20/run3-s*.png` 截图对比，给用户看。

### 4.2 换一篇不出名的论文（约 10 额度）
`eval/papers/visualization.pdf`（基因组可视化十条规则）和 `deep-learning-review.pdf`（综述，用来验证"没有实验就不生成实验页"）。目的是证明内容来自 PDF，而不是模型记得 BERT。

### 4.3 评测（约 30–50 额度）
- 指标：引文有效率、引文支持率、数字准确率（人工复核）、关键事实覆盖率、排版合格率、每篇额度与耗时（定义见 DESIGN §7）。
- 用同一篇论文在 Anna 官方 PPT 生成器里也生成一份，做对比（官方生成 9 页约 900 积分，注意额度）。
- 结果写入 README 与 `prompts/README.md` 迭代记录。

### 4.4 打磨（视时间）
- 预览里的引用气泡会挡住正文（UI 定位问题）。
- 大纲编辑器显示的是模块标签，标题在输入框里，自动化脚本读 `innerText` 拿不到标题。
- 生产包 5.7 MB，有 chunk 体积警告（可接受，可拆分）。

### 4.5 发布与交付（题目硬性要求）
1. `anna-app apps publish` → `anna-app apps submit-review`（用户会联系 HR 加速审核）。
2. **用另一个账号**在 staging 安装并跑通一次。
3. README：定位、核心设计判断（DESIGN §2 的论点 + 今天的真实问题与修复）、架构、边界条件、评测数据、额度记录、已知限制、截图。
4. 交付：GitHub URL、App name（Paper2Slides）、slug（paper2slides）。仓库目前是**私有**，交付前确认是否需要改公开，或邀请对方。

## 5. 约定（务必遵守）

- **花额度前先问用户。**
- **不要擅自发布**（`anna-app apps publish/submit-review/release`）。
- 用户要讨论时只讨论，不动手；文档先行。
- 优先用成熟开源库；联网调研交给 gpt-6.2-sol（Lody Role `5f850a58-e61c-4fd7-b398-b7127835b8a3`，machine `7e33479f-13cd-400f-8942-9fb4fb3ec838`）。
- 分派规则：并发 ≤ 3，每个任务独立分支，只改自己负责的目录，共享契约只做新增；我负责验收合并。
- 回复用户要简洁（中文）。
- Commit 结尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 6. 自动化跑真实流程的脚本（不在仓库里）

`/tmp/p2s-cdp/real.mjs`（puppeteer-core + 本机 Chrome）：打开 harness → 上传 PDF → 点"理解论文并生成大纲" → 点"生成幻灯片" → 截图并导出。日志写到 `/tmp/p2s-real-run.log`，产物在 `/tmp/p2s-real-out/`，任何一步出现"操作失败"就停止，并导出调用日志和截图。

`/tmp` 可能被清理。如果脚本不在了，在仓库外重建：在 `/tmp/p2s-cdp` 里 `npm i puppeteer-core@23`。逻辑是从 harness 页面里找 URL 含 `/dev/` 的 iframe，然后用 `[...document.querySelectorAll("button")].find(x => x.textContent.includes("…"))` 点击按钮。

## 7. 已知风险

- 平台模型 mimo-v2.5 的输出格式偏差较多，后面几页（表格、关键数字）可能还会碰到新问题。处理方式是：保存原始输出，归一化，补回归测试。
- 新提示词要求的内容更多，单篇额度预计上升到 8–15。
- 核验是词面和数字层面的，不能保证语义正确，README 里要如实写明。
