type SwipeDirection = "previous" | "next";

export type RangeSwipeProgress = {
  direction: SwipeDirection | null;
  /** 0–1 的有效距离进度，供视觉层调整提示强度。 */
  progress: number;
  /**
   * 手势已锁定为横向、但未成为范围候选时，这是范围内的普通横向浏览：
   * 视觉层应按此像素位移滚动画布（`scrollLeft = 起始 scrollLeft - panBy`）。
   * 候选成立、纵向动作或手势未跟踪时为 0。
   */
  panBy: number;
};

type RangeSwipeMetrics = {
  /** 可见时间轴宽度（滚动视口 clientWidth），阈值基准。 */
  timelineWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

type RangeSwipeBeginInput = RangeSwipeMetrics & {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  /** 浏览器视口宽度，用于左右边缘保留区判定。 */
  viewportWidth: number;
  now: number;
};

type RangeSwipeMoveInput = {
  pointerId: number;
  clientX: number;
  clientY: number;
};

export type RangeSwipeOptions = {
  minThreshold?: number;
  maxThreshold?: number;
  thresholdRatio?: number;
  dominanceRatio?: number;
  /** 浏览器视口左右边缘保留区，落在此范围内起手的触摸不由应用接管。 */
  edgeReserve?: number;
  cooldownMs?: number;
  /** 噪声地板：位移总和低于该值前不判定方向，避免起手抖动直接取消。 */
  moveSlop?: number;
};

const rangeSwipeDefaults = {
  minThreshold: 48,
  maxThreshold: 80,
  thresholdRatio: 0.15,
  dominanceRatio: 1.5,
  edgeReserve: 24,
  cooldownMs: 300,
  moveSlop: 8,
} as const;

const IDLE_PROGRESS: RangeSwipeProgress = { direction: null, progress: 0, panBy: 0 };

/** 有效水平距离阈值：可见宽度 15%，钳制在 48–80 CSS px。 */
export function rangeSwipeThreshold(timelineWidth: number, options: RangeSwipeOptions = {}): number {
  const { minThreshold, maxThreshold, thresholdRatio } = { ...rangeSwipeDefaults, ...options };
  const width = Number.isFinite(timelineWidth) && timelineWidth > 0 ? timelineWidth : 0;
  const scaled = width * thresholdRatio;
  if (!Number.isFinite(scaled) || scaled <= minThreshold) return minThreshold;
  return Math.min(scaled, maxThreshold);
}

type ActiveGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  allowPrevious: boolean;
  allowNext: boolean;
  threshold: number;
  locked: boolean;
  cancelled: boolean;
  direction: SwipeDirection | null;
  progress: number;
};

/**
 * 单指时间轴范围滑动的纯判定状态机（spec R2–R4/D4–D10/D15/D16）。
 *
 * 只接受 `pointerType === "touch"` 的单指序列：鼠标、触控板与触控笔永远不产生结果。
 * 只有手势起手时已位于对应横向边界才可能成为上一/下一范围候选；从范围内部起手、途中
 * 到达边界的动作保持普通滚动。松手时提交，反向拉回阈值内或先形成纵向意图即取消。
 * 本模块不接触 DOM、不写页面状态、不调用 API。
 */
export function createRangeSwipeRecognizer(options: RangeSwipeOptions = {}) {
  const config = { ...rangeSwipeDefaults, ...options };
  let active: ActiveGesture | null = null;
  let cooldownUntil = 0;

  const reset = () => {
    active = null;
  };

  const cancel = () => {
    if (active) active.cancelled = true;
    reset();
  };

  const begin = (input: RangeSwipeBeginInput): boolean => {
    if (input.pointerType !== "touch") {
      cancel();
      return false;
    }
    // 第二触点：立即取消整次手势，且不启动新的追踪。
    if (active) {
      cancel();
      return false;
    }
    if (input.now < cooldownUntil) return false;
    if (config.edgeReserve > 0 && input.viewportWidth > 0
      && (input.clientX < config.edgeReserve || input.viewportWidth - input.clientX < config.edgeReserve)) {
      return false;
    }

    const maxScrollLeft = Math.max(0, input.scrollWidth - input.timelineWidth);
    const tolerance = 1;
    active = {
      pointerId: input.pointerId,
      startX: input.clientX,
      startY: input.clientY,
      allowPrevious: input.scrollLeft <= tolerance,
      allowNext: input.scrollLeft >= maxScrollLeft - tolerance,
      threshold: rangeSwipeThreshold(input.timelineWidth, config),
      locked: false,
      cancelled: false,
      direction: null,
      progress: 0,
    };
    return true;
  };

  const move = (input: RangeSwipeMoveInput): RangeSwipeProgress => {
    if (!active) return IDLE_PROGRESS;
    if (input.pointerId !== active.pointerId) {
      cancel();
      return IDLE_PROGRESS;
    }

    const dx = input.clientX - active.startX;
    const dy = input.clientY - active.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!active.locked) {
      // 噪声地板只约束方向判定；锁定后必须继续重算进度，否则拉回起点时进度会滞留。
      if (absDx + absDy < config.moveSlop) return IDLE_PROGRESS;
      // 先形成纵向意图：保持原生纵向滚动，取消整次手势。
      if (absDy > absDx) {
        cancel();
        return IDLE_PROGRESS;
      }
      if (absDx < config.dominanceRatio * absDy) return IDLE_PROGRESS;
      active.locked = true;
    }

    // 方向必须与起手时所在边界一致：左边界右滑候选上一范围，右边界左滑候选下一范围。
    const direction: SwipeDirection | null = dx > 0
      ? (active.allowPrevious ? "previous" : null)
      : dx < 0
        ? (active.allowNext ? "next" : null)
        : null;
    active.direction = direction;
    active.progress = direction ? Math.min(1, absDx / active.threshold) : 0;
    // 锁定横向但不是候选 → 范围内的普通横向浏览，交给视觉层平移画布。
    return { direction: active.direction, progress: active.progress, panBy: direction ? 0 : dx };
  };

  const end = (input: { pointerId: number; now: number }): SwipeDirection | null => {
    const gesture = active;
    reset();
    if (!gesture || gesture.cancelled) return null;
    if (input.pointerId !== gesture.pointerId) return null;
    if (!gesture.locked || !gesture.direction || gesture.progress < 1) return null;
    cooldownUntil = input.now + config.cooldownMs;
    return gesture.direction;
  };

  const progress = (): RangeSwipeProgress => (active ? { direction: active.direction, progress: active.progress, panBy: 0 } : IDLE_PROGRESS);

  const isTracking = () => active !== null;

  return { begin, move, end, cancel, progress, isTracking };
}
