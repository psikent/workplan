import { describe, expect, it } from "vitest";
import { createRangeSwipeRecognizer, rangeSwipeThreshold } from "./timeline-swipe";

const VIEWPORT = 1024;
const TIMELINE_WIDTH = 390;
// 390 * 15% = 58.5 → 阈值；横向位移须达到该值才能提交。
const THRESHOLD = 58.5;

function beginInput(overrides: Partial<Parameters<ReturnType<typeof createRangeSwipeRecognizer>["begin"]>[0]> = {}) {
  return {
    pointerId: 1,
    pointerType: "touch",
    clientX: 400,
    clientY: 300,
    viewportWidth: VIEWPORT,
    timelineWidth: TIMELINE_WIDTH,
    scrollLeft: 0,
    scrollWidth: TIMELINE_WIDTH,
    now: 1_000,
    ...overrides,
  };
}

function withOverflow(scrollLeft: number) {
  return { timelineWidth: TIMELINE_WIDTH, scrollWidth: TIMELINE_WIDTH * 2, scrollLeft };
}

// 同一用例内连续发起多次手势时关闭冷却，避免用例在 300ms 冷却窗口内互相干扰。
function noCooldown() {
  return createRangeSwipeRecognizer({ cooldownMs: 0 });
}

describe("rangeSwipeThreshold", () => {
  it("clamps to 48–80 CSS px around the 15% ratio", () => {
    expect(rangeSwipeThreshold(200)).toBe(48);
    expect(rangeSwipeThreshold(320)).toBe(48);
    expect(rangeSwipeThreshold(390)).toBeCloseTo(58.5, 5);
    expect(rangeSwipeThreshold(400)).toBe(60);
    expect(rangeSwipeThreshold(1000)).toBe(80);
  });

  it("falls back to the minimum for missing or non-finite widths", () => {
    expect(rangeSwipeThreshold(0)).toBe(48);
    expect(rangeSwipeThreshold(Number.NaN)).toBe(48);
    expect(rangeSwipeThreshold(-100)).toBe(48);
  });
});

describe("range swipe recognition", () => {
  it("requires the full adaptive threshold to commit on release", () => {
    const recognizer = createRangeSwipeRecognizer();
    expect(recognizer.begin(beginInput())).toBe(true);

    const progress = recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD - 1, clientY: 300 });
    expect(progress.direction).toBe("previous");
    expect(progress.progress).toBeLessThan(1);
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("commits exactly one direction when the threshold is reached", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    const progress = recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
    expect(progress).toEqual({ direction: "previous", progress: 1, panBy: 0 });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("previous");
    // 一次手势只移动一步：结束后不再有任何结果。
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD * 3, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.end({ pointerId: 1, now: 1_200 })).toBeNull();
  });

  it("maps the swipe sign to the adjacent range only at the matching edge", () => {
    const recognizer = noCooldown();
    // 左边界右滑 → 上一范围
    recognizer.begin(beginInput());
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).direction).toBe("previous");
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("previous");

    // 右边界左滑 → 下一范围
    recognizer.begin(beginInput({ ...withOverflow(TIMELINE_WIDTH), clientX: 400, now: 1_500 }));
    expect(recognizer.move({ pointerId: 1, clientX: 400 - THRESHOLD, clientY: 300 }).direction).toBe("next");
    expect(recognizer.end({ pointerId: 1, now: 1_500 })).toBe("next");
  });

  it("offers both directions when the range has no horizontal overflow", () => {
    const recognizer = noCooldown();
    recognizer.begin(beginInput());
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).direction).toBe("previous");
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("previous");

    recognizer.begin(beginInput({ now: 1_500 }));
    expect(recognizer.move({ pointerId: 1, clientX: 400 - THRESHOLD, clientY: 300 }).direction).toBe("next");
    expect(recognizer.end({ pointerId: 1, now: 1_600 })).toBe("next");
  });

  it("pans in range without becoming a candidate while there is still scroll room", () => {
    const recognizer = noCooldown();
    // 起手在范围中部：向两侧都在余量内，只是平移画布，不成为范围候选。
    recognizer.begin(beginInput(withOverflow(TIMELINE_WIDTH / 2)));
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD * 2, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: THRESHOLD * 2 });
    expect(recognizer.move({ pointerId: 1, clientX: 400 - THRESHOLD * 2, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: -THRESHOLD * 2 });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("turns into a candidate once an in-range drag passes the edge by the threshold", () => {
    const recognizer = noCooldown();
    // 起手距右边界 100px：前 100px 只滚动，继续外滑越界达阈值即候选。
    recognizer.begin(beginInput({ ...withOverflow(TIMELINE_WIDTH - 100) }));
    expect(recognizer.move({ pointerId: 1, clientX: 400 - 100, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: -100 });
    const progress = recognizer.move({ pointerId: 1, clientX: 400 - (100 + THRESHOLD), clientY: 300 });
    expect(progress.direction).toBe("next");
    expect(progress.progress).toBe(1);
    expect(progress.panBy).toBe(0);
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("next");
  });

  it("keeps scrolling inward inert even at the boundary", () => {
    const recognizer = noCooldown();
    // 起手在左边界，但向左滑是浏览范围内日期，不是下一范围。
    recognizer.begin(beginInput(withOverflow(0)));
    expect(recognizer.move({ pointerId: 1, clientX: 400 - THRESHOLD, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: -THRESHOLD });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();

    recognizer.begin(beginInput({ ...withOverflow(TIMELINE_WIDTH), now: 1_500 }));
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: THRESHOLD });
    expect(recognizer.end({ pointerId: 1, now: 1_600 })).toBeNull();
  });

  it("cancels the gesture when the pointer reverses below the threshold before release", () => {
    const recognizer = noCooldown();
    recognizer.begin(beginInput());
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).progress).toBe(1);
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD / 2, clientY: 300 }).progress).toBeLessThan(1);
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("requires horizontal dominance of 1.5x over the vertical displacement", () => {
    const recognizer = noCooldown();
    recognizer.begin(beginInput());
    // 60 / 40 = 1.5 → 刚好锁定
    expect(recognizer.move({ pointerId: 1, clientX: 460, clientY: 340 }).direction).toBe("previous");
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("previous");

    // 59 / 40 < 1.5 → 方向未定，既不候选也不取消
    recognizer.begin(beginInput({ now: 1_500 }));
    expect(recognizer.move({ pointerId: 1, clientX: 459, clientY: 340 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).direction).toBe("previous");
  });

  it("cancels as soon as the action turns clearly vertical", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    expect(recognizer.move({ pointerId: 1, clientX: 430, clientY: 380 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.isTracking()).toBe(false);
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("stays pending on an ambiguous diagonal instead of cancelling the whole gesture", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    // dx=10, dy=12：纵向略占优但未达 1.5 倍 → 含糊阶段，不取消也不锁定（真机抖动的典型形状）。
    expect(recognizer.move({ pointerId: 1, clientX: 410, clientY: 312 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.isTracking()).toBe(true);
    // 继续横滑达 1.5 倍后正常锁定并成为候选。
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).direction).toBe("previous");
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("previous");
  });

  it("starts turning the page as soon as the drag passes the far edge", () => {
    // 起手贴近右边界（余量 8px）：左滑 8px 到边界只平移，继续越界达阈值即候选。
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput({ ...withOverflow(TIMELINE_WIDTH - 8) }));
    expect(recognizer.move({ pointerId: 1, clientX: 400 - 8, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: -8 });
    expect(recognizer.move({ pointerId: 1, clientX: 400 - 8 - THRESHOLD, clientY: 300 }).direction).toBe("next");
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBe("next");

    // 越界不足阈值：给出方向反馈（progress<1）但松手不提交。
    const recognizer2 = createRangeSwipeRecognizer();
    recognizer2.begin(beginInput({ ...withOverflow(TIMELINE_WIDTH - 8) }));
    const partial = recognizer2.move({ pointerId: 1, clientX: 400 - 8 - 20, clientY: 300 });
    expect(partial.direction).toBe("next");
    expect(partial.progress).toBeLessThan(1);
    expect(recognizer2.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("ignores sub-slop jitter so a slow start is not cancelled", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    expect(recognizer.move({ pointerId: 1, clientX: 402, clientY: 303 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.isTracking()).toBe(true);
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 }).direction).toBe("previous");
  });

  it("leaves the browser edge reserve untouched", () => {
    const recognizer = createRangeSwipeRecognizer();
    expect(recognizer.begin(beginInput({ clientX: 10 }))).toBe(false);
    expect(recognizer.begin(beginInput({ clientX: VIEWPORT - 10 }))).toBe(false);
    expect(recognizer.begin(beginInput({ clientX: 24 }))).toBe(true);
    recognizer.cancel();
    expect(recognizer.begin(beginInput({ clientX: VIEWPORT - 24 }))).toBe(true);
  });

  it("cancels the tracked gesture when a second touch arrives", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    expect(recognizer.begin(beginInput({ pointerId: 2, clientX: 500 }))).toBe(false);
    expect(recognizer.isTracking()).toBe(false);
    expect(recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("cancels on every interruption path without changing range", () => {
    for (const interrupt of ["pointercancel", "blur", "lostpointercapture"]) {
      const recognizer = createRangeSwipeRecognizer();
      recognizer.begin(beginInput());
      recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
      recognizer.cancel();
      expect(recognizer.end({ pointerId: 1, now: 1_100 }), interrupt).toBeNull();
    }

    // 指针 id 不匹配（例如另一根手指的遗留事件）同样取消。
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
    expect(recognizer.move({ pointerId: 7, clientX: 500, clientY: 300 })).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.end({ pointerId: 1, now: 1_100 })).toBeNull();
  });

  it("never produces a result for mouse, trackpad or stylus input", () => {
    for (const pointerType of ["mouse", "pen", ""]) {
      const recognizer = createRangeSwipeRecognizer();
      expect(recognizer.begin(beginInput({ pointerType })), pointerType).toBe(false);
      expect(recognizer.move({ pointerId: 1, clientX: 400 - THRESHOLD, clientY: 300 }), pointerType).toEqual({ direction: null, progress: 0, panBy: 0 });
      expect(recognizer.end({ pointerId: 1, now: 1_100 }), pointerType).toBeNull();
    }
  });

  it("rejects further gestures during the 300ms cooldown after a success", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
    expect(recognizer.end({ pointerId: 1, now: 2_000 })).toBe("previous");

    expect(recognizer.begin(beginInput({ now: 2_299 }))).toBe(false);
    expect(recognizer.begin(beginInput({ now: 2_300 }))).toBe(true);
    recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
    expect(recognizer.end({ pointerId: 1, now: 2_400 })).toBe("previous");
  });

  it("reports idle progress outside a gesture", () => {
    const recognizer = createRangeSwipeRecognizer();
    expect(recognizer.progress()).toEqual({ direction: null, progress: 0, panBy: 0 });
    expect(recognizer.isTracking()).toBe(false);
  });

  it("does not start a cooldown for cancelled or failed gestures", () => {
    const recognizer = createRangeSwipeRecognizer();
    recognizer.begin(beginInput());
    recognizer.move({ pointerId: 1, clientX: 400 + THRESHOLD, clientY: 300 });
    recognizer.move({ pointerId: 1, clientX: 400, clientY: 300 });
    expect(recognizer.end({ pointerId: 1, now: 2_000 })).toBeNull();
    expect(recognizer.begin(beginInput({ now: 2_010 }))).toBe(true);
  });
});
