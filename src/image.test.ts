import { describe, expect, it } from "vitest";
import { outputSize, turn } from "./image";

describe("turn", () => {
  it("cycles clockwise", () => expect([0, 90, 180, 270].map((r) => turn(r as 0, 1))).toEqual([90, 180, 270, 0]));
  it("cycles counter-clockwise", () => expect([0, 90, 180, 270].map((r) => turn(r as 0, -1))).toEqual([270, 0, 90, 180]));
  it("four turns return to the start", () => {
    let r: 0 | 90 | 180 | 270 = 90;
    for (let i = 0; i < 4; i++) r = turn(r, -1);
    expect(r).toBe(90);
  });
});

describe("outputSize", () => {
  it("keeps size when already small enough", () => expect(outputSize(960, 1706, 0, 1800)).toMatchObject({ width: 960, height: 1706, scale: 1 }));
  it("swaps width and height for 90 and 270", () => {
    expect(outputSize(960, 1706, 90, 1800)).toMatchObject({ width: 1706, height: 960 });
    expect(outputSize(960, 1706, 270, 1800)).toMatchObject({ width: 1706, height: 960 });
    expect(outputSize(960, 1706, 180, 1800)).toMatchObject({ width: 960, height: 1706 });
  });
  it("downscales so the long edge is at most maxEdge, keeping aspect ratio", () => {
    const o = outputSize(4000, 3000, 0, 1800);
    expect(o.width).toBe(1800);
    expect(o.height).toBe(1350);
  });
  it("measures the long edge after rotation", () => {
    const o = outputSize(3000, 4000, 90, 1800);
    expect(o).toMatchObject({ width: 1800, height: 1350 });
  });
  it("never returns a zero-sized canvas", () => expect(outputSize(1, 5000, 0, 1800).width).toBe(1));
});
