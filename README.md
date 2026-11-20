# Paper2Slides

上传论文 PDF，生成**每句话有出处、每个数字经过核验**的组会汇报 PPT。一个运行在 [Anna](https://staging.anna.partners) 平台上的 Anna App。

> 开发中。设计：[docs/DESIGN.md](docs/DESIGN.md) · 交接：[docs/HANDOFF.md](docs/HANDOFF.md) · 日志：[docs/LOG-2026-11-20.md](docs/LOG-2026-11-20.md) · 平台实测：[docs/PLATFORM-PROBE.md](docs/PLATFORM-PROBE.md)

## 开发

```bash
npm install
npm test            # 单元测试
npm run build       # 编译提示词 + 类型检查 + 打包到 bundle/
anna-app validate   # 校验 manifest + bundle
anna-app dev        # 本地 harness
```

提示词源文件在 `prompts/*.md`，构建时编译为 `src/prompts/generated.ts`（平台 bundle 不允许 .md 文件）。
