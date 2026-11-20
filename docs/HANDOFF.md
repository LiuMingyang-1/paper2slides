# 交接文档（截至 2026-11-21）

> 给接手的人（包括新会话的 Claude）。决策与问题按时间记录在 [LOG-2026-11-20.md](LOG-2026-11-20.md)（第一轮）和 [LOG-2026-11-21.md](LOG-2026-11-21.md)（第二轮），设计见 [DESIGN.md](DESIGN.md)，对外说明见 [README](../README.md)。

## 1. 一句话现状

**功能完成，真实模型端到端已跑通，内容来源测试已通过，README 已写好，已知 bug 已修。** 剩下的是：**由用户决定**发布、仓库是否公开，最后用另一个账号装一次。

## 2. 环境与入口

| 项 | 值 |
|---|---|
| 本地路径 | 仓库根目录（本机克隆位置） |
| 仓库 | 私有 `LiuMingyang-1/paper2slides`，分支 `main` |
| Anna 账号 | staging，已开通开发者，`anna-app login` 已登录（PAT 约 90 天） |
| Anna App | `[DRAFT] paper2slides (id=288)`，slug `paper2slides`（不可改） |
| 平台模型 | `xiaomi/mimo-v2.5`（平台分配，App 不能改） |
| 额度 | 已用约 69 / 1000 |

```bash
npm install
npm test                       # 207 个测试
npm run build                  # 编译提示词 + 类型检查 + 打包到 bundle/
anna-app validate
npm run dev:web                # 纯前端 http://localhost:5173/ ——「试用 BERT Demo」零额度
npm run build && anna-app dev --port 5182 --no-watch   # 本地 harness，连真实 AI（会扣额度）
```

## 3. 代码地图

| 目录 | 内容 | 关键点 |
|---|---|---|
| `src/parser/` | pdf.js 解析、切块、剔除参考文献、截图 | `eval/papers/*.parsed.json` 是 3 篇论文的解析结果 |
| `src/retrieval/` | MiniSearch BM25、向量、RRF | 向量默认关 |
| `src/verify/` | 引文/数字核验、跨语言锚点、数词、比例、百分点 | 核心卖点；`run6.test.ts`、`run7.test.ts` 是真实输出的核验回放 |
| `src/llm/` | 调用、重试、容错解析 | `fixtures/` 是真实模型原始输出；`real-output.test.ts` 是回归 |
| `src/schema/` | Valibot 校验 + 归一化（宽进严出） | `layouts.ts` 是内容与版式的契约 |
| `src/pipeline/` | understand → outline → slides，缓存 | 缓存键含提示词版本 |
| `src/layout/`, `src/export/` | 6 种版式、自适应、PPTX 导出 | 预览与导出共用测量 |
| `src/ui/`, `src/store/` | 三栏 UI、气泡、核验面板、Demo | Demo 数据在 `src/ui/demo/` |
| `prompts/` | 4 个提示词 + 迭代记录 | 当前：understand@3、outline@2、slide@4、compress@2（以 frontmatter 为准） |
| `eval/e2e/` | 端到端自动化脚本 | 见 §6 |
| `eval/grounding/` | 内容来源测试：篡改表、篡改 PDF 生成器、报告 | [REPORT.md](../eval/grounding/REPORT.md) |
| `eval/runs/2026-11-21/` | run5–7、三项来源测试的全部产物 | 截图、核验文字、calls.json、PPTX |
| `docs/images/` | README 用图、图标、改版截图 | `slides-gallery.png` 由真实截图拼成；`icon-256.png` 也是商店图标（`app.json` 的 `logo_file`） |
| `src/ui/assets/icon.svg`, `public/` | App 图标、favicon | 苹果风格界面规范见 [UI-REDESIGN.md](UI-REDESIGN.md) |
| `.agents/skills/apple-design/` | 项目内安装的苹果设计 skill（emilkowalski/skills） | `.claude/skills/` 下为软链接 |

## 4. 待办（按顺序）

### 4.1 ~~合并 T17~~（已完成）
PPTX 导出与 PDF 解析两侧统一过滤 XML 非法字符，e2e 脚本导出校验到 XML 层。

### 4.2 发布（需用户决定，不要擅自执行）
1. `anna-app apps publish` → `anna-app apps submit-review`（用户会联系 HR 加速审核）。
2. 审核通过后，**用另一个账号**在 staging 安装并跑通一次（约 8 额度）。

### 4.3 交付
- GitHub URL、App name（Paper2Slides）、slug（paper2slides）。
- 仓库目前**私有**：需用户决定改公开还是邀请对方。

### 4.4 可选（用户说不必追求完美）
- 表格核验加入行列约束（目前表格错列时仍判 ✅）。
- 表格页模型偶尔输出 5 列需重试一次。
- 表格页只引一张表时会提示「引用多样性不足」（误报，仅日志）。
- 与 Anna 官方 PPT 生成器对比：约 900 积分，已决定不做。

## 5. 约定（务必遵守）

- **花额度前先问用户。**
- **不要擅自发布**（`anna-app apps publish/submit-review/release`）。
- 用户要讨论时只讨论，不动手；文档先行。
- 我只做任务理解、拆分、验收、合并；**编码交给 gpt-6.2-sol**（Lody Agent Role，ID 见本机 Lody 配置），**每个子任务新开一个会话**，`workContext` 用 GitHub 仓库，独立分支 `task/Tn-*`，并发 ≤ 3。
- 优先用成熟开源库；联网调研也交给 gpt-6.2-sol。
- 回复用户要简洁（中文）。
- Commit 结尾：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 6. 端到端自动化脚本

脚本 `eval/e2e/real.mjs`，用法见 [eval/e2e/README.md](../eval/e2e/README.md)。先 `npm ci --prefix eval/e2e`。

- 零额度验证上传解析：`anna-app dev --port 5182 --no-watch --no-llm` + `node eval/e2e/real.mjs --stop-after parse`。
- 零额度验证截图与导出：`npm run dev:web` + `node eval/e2e/real.mjs --demo --replay-run6`。
- 真实流程（花额度）：`node eval/e2e/real.mjs --pdf eval/papers/bert.pdf --out /tmp/p2s-real`。可加 `--quota-limit N` 设额度上限、`--tamper <表>` 跑篡改实验。
- **缓存**：harness 的 `runtime_state` 以 App 会话为作用域，每次单独启动脚本都会新建会话，理解步骤要重新花约 2.8 额度。要复用缓存只能在同一会话内 `--repeat 2`。
- 后台运行 harness 时，Bash 后台任务默认 30 分钟会被结束，记得设长超时。
- 若某步失败：看产物里的 `calls-*-fail.json` 的 `rawOutput` 与 `normalizations`，原始输出存入 `src/llm/fixtures/`，在 `real-output.test.ts` 补回归测试再修。

## 7. 已知风险

- 平台模型输出格式偏差多，换新论文可能碰到新的格式问题。处理流程同上（存原始输出 → 归一化 → 回归测试）。
- 核验是词面与数字层面，不保证语义正确（README 已如实写明）。
- 单篇额度约 7–10，失败重试会更多。
