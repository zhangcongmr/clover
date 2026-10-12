/** 冒烟测试用 @angular/core 桩：仅替换 Injectable 装饰器，纯函数逻辑不受影响。 */
export function Injectable(_options?: unknown): (target: unknown) => unknown {
  return (target: unknown) => target;
}
