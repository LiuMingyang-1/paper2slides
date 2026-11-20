export const PPTX_WIDTH = 10;
export const PPTX_HEIGHT = 5.625;

type Rect = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

/** Normalize viewport coordinates so preview scaling and page scroll cancel out. */
export function rectToInches(rect: Rect, slide: Rect) {
  return {
    x: (rect.left - slide.left) * PPTX_WIDTH / slide.width,
    y: (rect.top - slide.top) * PPTX_HEIGHT / slide.height,
    w: rect.width * PPTX_WIDTH / slide.width,
    h: rect.height * PPTX_HEIGHT / slide.height,
  };
}
