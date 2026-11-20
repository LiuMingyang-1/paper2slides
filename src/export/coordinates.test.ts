import { describe, expect, it } from "vitest";
import { rectToInches } from "./coordinates";

describe("PPTX coordinates", () => {
  it("maps the slide bounds to the dimensions of LAYOUT_16x9", () => {
    const slide = { left: -10000, top: 31, width: 1280, height: 720 };
    expect(rectToInches(slide, slide)).toEqual({ x: 0, y: 0, w: 10, h: 5.625 });
  });

  it("preserves coordinates in a half-scale and offset preview", () => {
    const slide = { left: 74, top: -201, width: 640, height: 360 };
    const element = { left: 106, top: -137, width: 384, height: 128 };
    expect(rectToInches(element, slide)).toEqual({ x: 0.5, y: 1, w: 6, h: 2 });
  });
});
