import { describe, expect, it } from "vitest";
import { MAX_LONG_EDGE, targetSize } from "../src/image";

describe("targetSize", () => {
  it("keeps images that are already small enough", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales down the long edge of a landscape image", () => {
    expect(targetSize(4000, 2000)).toEqual({ width: MAX_LONG_EDGE, height: 640 });
  });

  it("scales down the long edge of a portrait image", () => {
    expect(targetSize(2000, 4000)).toEqual({ width: 640, height: MAX_LONG_EDGE });
  });

  it("keeps square images square", () => {
    expect(targetSize(3000, 3000)).toEqual({ width: MAX_LONG_EDGE, height: MAX_LONG_EDGE });
  });

  it("does not divide by zero", () => {
    expect(targetSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
