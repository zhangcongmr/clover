
  # UI Design from Image

  This is a code bundle for UI Design from Image. The original project is available at https://www.figma.com/design/s968sw0u17yIlaCdnLjKPH/UI-Design-from-Image.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.
  
## SSE 兼容 HTTP 流式响应

  如果要把之前的 HTTP 流式响应改成 **SSE（Server-Sent Events）**，前端**既可以用 `EventSource` 接口（推荐），也可以继续使用 `fetch` API（手动解析 SSE 格式）**。两者都能接收 SSE 数据，但使用方式差异较大。

---

### 一、后端需要做的修改
要让后端符合 SSE 规范，需要调整以下内容：

1. **响应头**  
   ```ts
   c.header('Content-Type', 'text/event-stream; charset=utf-8');
   c.header('Cache-Control', 'no-cache');
   c.header('Connection', 'keep-alive');
   ```

2. **数据输出格式**  
   每条消息必须遵循 `data: <内容>\n\n` 的格式。  
   ```ts
   const content = part.choices[0].delta.content;
   // SSE 格式：data: 后面跟内容，换行，再空行表示一条消息结束
   const sseChunk = `data: ${content}\n\n`;
   controller.enqueue(encoder.encode(sseChunk));
   ```

3. **流结束时可发送一个 `[DONE]` 信号**  
   ```ts
   controller.enqueue(encoder.encode('data: [DONE]\n\n'));
   controller.close();
   ```

---

### 二、前端如何接收 SSE
#### ✅ 方案1：使用 `EventSource`（最简单）
浏览器内置的 `EventSource` API 自动处理 SSE 协议，包括重连、事件解析等。
```js
const eventSource = new EventSource('/ai_proxy');

eventSource.onmessage = (event) => {
  if (event.data === '[DONE]') {
    eventSource.close();
    return;
  }
  console.log('收到片段:', event.data);
  // 追加到聊天界面
};

eventSource.onerror = () => {
  eventSource.close();
};
```
**优点**：代码极简，自动重连，无需手动控制流。  
**缺点**：只能发送 GET 请求，无法自定义请求头（如传递 `Content-Type: application/json` 的 POST body）。如果你的接口是 POST，这种方案不可行。

#### ✅ 方案2：使用 `fetch` + 手动读取流
适用于 POST 请求或需自定义请求头、请求体的场景，完全兼容 SSE 格式，但需要自己解析流。
```js
const response = await fetch('/ai_proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, history })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // 保留不完整的行

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') return;
      // 处理 data 内容
    }
  }
}
```
**优点**：支持 POST，灵活控制。  
**缺点**：需手动解析 SSE 格式、处理分包、控制结束。

---

### 对比你代码中的当前逻辑
- 你的原始代码是 **`text/plain` 流式响应**，前端只能用 `fetch` + 逐块读取，没有协议字段。
- 改成 SSE 后，如果用 `EventSource`，只能发 GET 请求（除非你将消息放到 query 参数，或改为 WebSocket）。
- 如果你的 `/ai_proxy` 是 POST 接口（向服务端传 `message` 和 `history`），**必须继续用 `fetch` 手动处理 SSE 流**，此时前后端的改动量最小，只需后端按照 SSE 格式输出即可。

所以你的选择是：
- 若保持 **POST**，后端改成 SSE 格式，前端继续用 `fetch` 解析。
- 若可改为 **GET**，后端改成 SSE 格式后，前端可直接用 `EventSource`。