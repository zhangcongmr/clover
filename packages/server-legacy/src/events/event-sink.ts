/**
 * 会话事件总线契约（服务端内部 → 客户端）。
 *
 * 这是事件面的唯一出口/入口：`SseAcpClient`、`AcpSessionManager` 只负责
 * `append`，`SseManager`、`promptAndWait` 只负责 `attach`。当前实现是进程内
 * 队列（`InProcessEventSink`），替换传输不需要改调用方。
 *
 * 注意：控制面（prompt / cancel / permission 命令）**不**走这里，仍由
 * `acp:prompt:*` / `acp:permission:*` 承担——两者的语义不同（事件可广播，
 * 命令必须恰好一次），后续会分开演进。
 */

/** 会话事件信封。字段刻意保持宽松：`type`/`payload` 的约定由各来源自行定义。 */
export interface SessionEvent {
  type: string;
  payload?: any;
  timestamp: number;
  /** 产生该事件的 ACP 会话 id（部分事件由调用方补齐）。 */
  sessionId?: string;
  /** prompt / permission 请求的关联 id。 */
  requestId?: string;
  /**
   * 会话内单调序号，由 `EventSink` 在 `append` 时赋值（不是调用方的事）。
   *
   * SSE 用它作为 `id:` 字段，前端可在重连时通过 `Last-Event-ID` 续传；
   * 不支持续传的实现可以不赋值。
   */
  seq?: number;
}

/** `attach` 的可选行为。 */
export interface AttachOptions {
  /**
   * 只补发 `seq > afterSeq` 的历史事件（断线续传）。
   *
   * 缺省 **不补发任何历史**——新连接只接收 attach 之后的事件，这与改造前
   * 的 pub/sub 语义一致，也避免新打开的标签页收到上一轮会话的陈旧事件。
   */
  afterSeq?: number;
  /**
   * ring 窗口不足以覆盖 `afterSeq`（中间事件已被淘汰）时回调。
   *
   * 上层据此要求客户端重新执行 `session/load` 补齐历史，而不是静默地
   * 让界面缺一段内容。只在确实发生空洞时调用。
   */
  onGap?: (oldestRetainedSeq: number) => void;
}

/**
 * 事件汇聚点。
 *
 * 之所以抽这一层：当前 `publish`/`subscribe` 调用点散落在 ACP 客户端、
 * 会话管理器和 SSE 管理器三处，换成别的传输（进程内队列、Streamable HTTP）
 * 需要同时改这三处。收敛到 `EventSink` 后，替换传输只是换一个实现。
 */
export interface EventSink {
  /**
   * 向某个会话的事件流追加一条事件。
   *
   * 返回 Promise 以便需要顺序保证的调用方（如 `session_loaded` 标记）等待
   * 投递完成；不关心顺序的调用方可以 fire-and-forget（自行 catch）。
   */
  append(sessionId: string, event: SessionEvent): Promise<void>;

  /**
   * 订阅某个会话的事件流。
   *
   * 实现需要支持同一会话多个订阅者（当前 `SseManager` 每条 SSE 连接一个），
   * 但这是实现细节：调用方只承诺「我能收到该会话后续的事件」。
   *
   * @returns 取消订阅函数
   */
  attach(
    sessionId: string,
    handler: (event: SessionEvent) => void,
    options?: AttachOptions,
  ): () => void;
}
