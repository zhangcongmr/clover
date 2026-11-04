/**
 * 骨架屏（skeleton）公共常量与时序控制。
 *
 * 远程数据源（官方 MCP Registry、Skill HTTP Catalog）加载时先用占位块撑出
 * 布局，数据到达后再替换成真实列表，避免出现空白区域与布局跳动。
 */

/**
 * 骨架屏最短展示时长（ms）。
 *
 * 远程请求可能秒回，骨架屏若只闪一帧反而比纯文字提示更刺眼 —— 因此保证
 * 骨架至少停留这么久，再切换到真实内容。
 */
export const MIN_SKELETON_DURATION = 350;

/** 骨架屏占位行数（与真实列表的视觉密度接近）。 */
export const SKELETON_ROW_COUNT = 6;

/** 生成骨架屏占位行索引。 */
export function createSkeletonRows(count: number = SKELETON_ROW_COUNT): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/**
 * 骨架屏最短展示时长闸门。
 *
 * 远程数据源就绪时调用 {@link end}，若距 {@link begin} 不足
 * MIN_SKELETON_DURATION 则延后到满足后再隐藏骨架，避免骨架一闪而过。
 * 重复调用 {@link end} 会取消上一次挂起的回调（以最后一次为准）。
 */
export class SkeletonGate {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;

  /**
   * 记录骨架展示的起始时间。
   *
   * 同时清掉上一次挂起的 {@link end} 回调 —— 否则旧请求的定时器会在新请求
   * 仍在飞行时把加载态提前关掉。
   */
  begin(): void {
    this.startedAt = Date.now();
    this.clear();
  }

  /**
   * 请求结束展示：不足最短时长时延后调用 onDone。
   * @param onDone 隐藏骨架的回调。
   */
  end(onDone: () => void): void {
    const elapsed = Date.now() - this.startedAt;
    const remaining = Math.max(0, MIN_SKELETON_DURATION - elapsed);

    this.clear();
    if (remaining === 0) {
      onDone();
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      onDone();
    }, remaining);
  }

  /** 取消挂起的回调（组件销毁时调用）。 */
  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
