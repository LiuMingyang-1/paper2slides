# Paper2Slides 端到端脚本

需要 Node.js 20+ 和本机 Chrome。下面的命令从仓库根目录运行。脚本默认使用 macOS 的 Google Chrome 安装路径，其他平台默认从 PATH 查找 `google-chrome`，也可以通过 `CHROME_PATH` 指定可执行文件。

```bash
npm ci --prefix eval/e2e
```

## 零额度验证

启动前端后，在另一个终端运行脚本。内置 BERT Demo 生成 5 页。加上 `--replay-run6` 可在同一套 Demo 界面中回放仓库归档的 10 页 run6，使用本机 PDF 解析和浏览器下载。

```bash
npm run dev:web
```

```bash
node eval/e2e/real.mjs --demo
node eval/e2e/real.mjs --demo --replay-run6 --repeat 2 --out /tmp/p2s-run6
unzip -tq /tmp/p2s-run6/run-01/deck.pptx
```

也可通过禁用 LLM 的 Anna harness 验证真实文件上传和解析。

```bash
npm run build
anna-app dev --port 5182 --no-watch --no-llm
```

```bash
node eval/e2e/real.mjs --stop-after parse
```

## 真实流程

获得额度授权后，启动 `anna-app dev --port 5182 --no-watch`，再运行以下命令。真实理解和生成阶段会调用模型并扣额度。导出阶段读取页面的「下载 PPTX」链接，由 Node 下载附件。

```bash
node eval/e2e/real.mjs --pdf eval/papers/bert.pdf --out /tmp/p2s-real --stop-after export
```

- `--pdf <路径>` 默认为仓库中的 `eval/papers/bert.pdf`。Demo 使用内置 BERT PDF。
- `--tamper <替换表>` 先在输出目录生成 `input-tampered.pdf`，然后走同一上传流程。BERT 替换表校验原始 PDF 的 SHA-256 和每条规则的匹配次数。生成器依赖 Python 3 和 PyMuPDF 2.1。
- `--quota-limit <额度> --quota-prior <已用额度>` 对本地 Anna harness 的模型请求保留额度，并用服务端返回的 `quotaConsumed` 结算。T16 的费率依据 run7 向上取整，预留按 UTF-8 字节数估算输入、按 `maxTokens` 估算输出。每次重启脚本前，将之前的实际消耗之和传给 `--quota-prior`。调用结果缺少额度时，守卫会拦截后续模型调用。
- `--url <地址>` 可覆盖默认地址。Harness 默认使用 `http://127.0.0.1:5182/`，Demo 默认使用 `http://127.0.0.1:5173/`。
- `--stop-after <阶段>` 支持 `parse`、`understand`、`slides`、`export`，默认跑到 `export`。`understand` 包括生成大纲，`slides` 包括逐页截图和核验面板文字。
- `--out <目录>` 指定产物目录。默认在 `eval/out/` 下创建新的运行目录。每轮产物包括适用的 `outline.txt`、`slide-01.png` 到末页截图、对应的 `slide-01-verification.txt`、`slides.json`（预览要点、引用 ID 与逐条核验状态）、`calls-final.json` 和 `deck.pptx`。导出时检查 ZIP 文件头、中央目录、PPTX 入口和文件大小。
- 根输出目录的 `progress.log` 与终端同步写入。等待阶段每 5 秒记录进度与累计额度。遇到「操作失败」立即停止，保存 `<阶段>-fail.png`、`calls-<阶段>-fail.json`，并以非零状态退出。
- `--repeat <次数>` 在同一个页面和 App 实例内用「更换论文」重复运行，产物写到 `run-01/`、`run-02/` 等子目录。额度和调用日志按会话累计，进度日志显示每轮新增调用数。

## 缓存

App 先查进程内的 Map，再查 `anna.storage` 里的 `paper2slides-cache-v1`。PDF 解析键是 `parsed:v1:<PDF 字节 SHA-256>`。模型步骤键为 `<paper.id>:<提示词 ID>@<版本>:<输入 SHA-256>`。其中 `paper.id` 来自 PDF 字节，输入哈希覆盖提示词变量、`maxTokens` 和可选的 `responseFormat`。同一份 PDF 重新选取时，文件名和 iframe 的 `wid` 都不会改变这些键。

默认的 Anna harness 使用以 App 窗口为作用域的内存 `runtime_state`。重新打开首页会关闭旧会话、创建新会话和 `wid`。固定 Chrome profile 仍会走这一步。用 `--repeat 2` 保持同一个 App 实例，比较两轮的新增调用数即可检查缓存。run6 离线回放的首轮有 12 条调用记录，第二轮新增 0 条。
