import { describe, expect, it } from "vitest";
import bert from "../../eval/papers/bert.parsed.json";
import review from "../../eval/papers/deep-learning-review.parsed.json";
import visualization from "../../eval/papers/visualization.parsed.json";
import type { Evidence } from "../types";
import { BM25Index } from "./bm25";
import { LegacyBM25Index } from "./test/legacy-bm25";

const papers = [
  { name: "BERT", paper: bert, queries: [
    "80.5% GLUE improvement",
    "93.2 SQuAD 1.1 F1",
    "1024 hidden size 16 attention heads",
    "masked language model",
    "next sentence prediction",
    "WordPiece embeddings",
    "bidirectional Transformer encoder",
    "why train with a masking objective",
    "does the benefit depend on model size",
    "how to adapt pretrained weights to downstream tasks",
  ] },
  { name: "Visualization", paper: visualization, queries: [
    "10 simple rules",
    "6 non-mutually exclusive categories collaborators",
    "Venn diagrams up to 3 sets",
    "JBrowse Ensembl IGV",
    "UpSet intersections",
    "Datasaurus visual encoding",
    "WebGL browser rendering",
    "how to decide whether to build a new tool",
    "why test on both simulated and real data",
    "how to keep a tool useful after release",
  ] },
  { name: "Deep Learning Review", paper: review, queries: [
    "Table 2 22–74 deep learning models",
    "Table 7 instance feature model parameter",
    "Table 8 77–143 federated centralized",
    "convolutional neural network CNN",
    "deep belief network restricted Boltzmann machine",
    "deep Q-network reinforcement learning",
    "vertical horizontal federated learning",
    "how to learn when all data cannot be stored in memory",
    "why transfer knowledge to a different task",
    "privacy and communication challenges across clients",
  ] },
];

describe.each(papers)("$name retrieval migration", ({ paper, queries }) => {
  const blocks = paper.blocks as Evidence[];
  const legacy = new LegacyBM25Index(blocks);
  const current = new BM25Index(blocks);

  it.each(queries)("preserves the ordered legacy Top-8 for %s", (query) => {
    const before = legacy.search(query, 8).map(({ evidenceId }) => evidenceId);
    const after = current.search(query, 8).map(({ evidenceId }) => evidenceId);
    expect(before.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });
});

it("keeps duplicate query terms neutral and sorts tied hits by evidence ID", () => {
  const block = bert.blocks[0] as Evidence;
  const blocks = [
    { ...block, id: "e1-2", text: "classification classification accuracy", sectionPath: ["Results", "Ablation"] },
    { ...block, id: "e1-1", text: "classification classification accuracy", sectionPath: ["Results"] },
    { ...block, id: "e1-3", text: "classification", sectionPath: ["Methods"] },
    { ...block, id: "e1-4", text: "" },
  ];
  const current = new BM25Index(blocks);
  const filter = { sectionPath: ["Results"] };
  const hits = current.search("classification accuracy classification", 2, filter);
  expect(hits.map(({ evidenceId }) => evidenceId)).toEqual(["e1-1", "e1-2"]);
  const reference = new LegacyBM25Index(blocks).search("classification accuracy", 2, filter);
  hits.forEach(({ score }, i) => expect(score).toBeCloseTo(reference[i]!.score, 12));
});
