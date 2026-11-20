# T1 公开论文样例

每篇论文配有同名 `.parsed.json`。JSON 由 Node 版解析器生成，保留证据坐标和图注，省略浏览器截图。PDF 原件保持发布方版本，JSON 提取并重排文字，移除了参考文献等内容。

| 文件 | 布局 | 作者与来源 |
| --- | --- | --- |
| `bert.pdf` | 双栏会议论文 | Jacob Devlin、Ming-Wei Chang、Kenton Lee、Kristina Toutanova。NAACL 2019，CC BY 4.0。[ACL Anthology](https://aclanthology.org/N19-1423/) |
| `visualization.pdf` | 单栏正文，首页带边栏 | Eloi Durant、Mathieu Rouard、Eric W. Ganko、Cedric Muller、Alan M. Cleary、Andrew D. Farmer、Matthieu Conte、Francois Sabot。PLOS Computational Biology，2022，Creative Commons Attribution。[PLOS](https://doi.org/10.1371/journal.pcbi.1010622) |
| `deep-learning-review.pdf` | 综述，混合跨栏和双栏 | Tala Talaei Khoei、Hadjar Ould Slimane、Naima Kaabouch。Neural Computing and Applications，2023，CC BY 4.0。[Springer](https://doi.org/10.1007/s00521-023-08957-4) |

从仓库根目录运行 `npx --no-install vite-node eval/papers/generate.ts` 可重建样例 JSON。Vitest 会重新读取原始 PDF，并校验输出和 JSON 一致。
