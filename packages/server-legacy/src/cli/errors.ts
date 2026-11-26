/**
 * CLI 用法错误（未知命令、非法选项、缺少参数…）。
 *
 * 与运行期错误区分：用法错误只打印消息 + 帮助，退出码 1；
 * 运行期错误（agent 起不来、ACP 报错）由命令自己处理。
 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}
