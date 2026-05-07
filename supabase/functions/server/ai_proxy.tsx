import { Hono } from 'npm:hono';
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { OpenAI } from 'npm:openai@6.36.0';

// 定义请求接口
interface AiRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

// 定义响应接口
interface AiResponse {
  success: boolean;
  reply?: string;
  error?: string;
}

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    credentials: true,  // 允许凭据
    maxAge: 600,
  }),
);

app.post('/ai_proxy', async (c) => {
  try {
    // 解析请求体
    const { message, history }: AiRequest = await c.req.json();

    // 验证请求参数
    if (!message) {
      return c.json({ success: false, error: 'Message is required' }, 400);
    }

    // 从环境变量获取API密钥
    const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
    if (!apiKey) {
      console.error('Missing DEEPSEEK_API_KEY environment variable');
      return c.json({
        success: false,
        error: 'Server configuration error: Missing API key'
      }, 500);
    }

    // 创建 OpenAI 客户端实例
    const openai = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey,
    });

    // 准备消息数组，包括历史记录和当前消息
    const messages = [
      { role: 'system' as const, content: 'You are a helpful assistant.' },
      ...history,
      { role: 'user' as const, content: message }
    ];

    // 设置响应头为 text/plain 以支持流式传输
    c.header('Content-Type', 'text/plain; charset=utf-8');
    c.header('Transfer-Encoding', 'chunked');

    // 使用 OpenAI 客户端发送请求
    const stream = await openai.chat.completions.create({
      messages: messages,
      model: 'deepseek-v4-pro',
      stream: true,
      extra_body: {
        "thinking": { "type": "disabled" }
      },
    });

    // 创建文本编码器，用于将字符串转换为 Uint8Array
    const encoder = new TextEncoder();

    // 创建一个可读流来处理响应
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const part of stream) {
          if (part.choices && part.choices[0]?.delta?.content) {
            // 将接收到的部分响应编码为字节后发送给客户端
            const content = part.choices[0].delta.content;
            controller.enqueue(encoder.encode(content));
          }
        }
        controller.close();
      },
    });

    return new Response(readableStream);
  } catch (error) {
    console.error('Unexpected error in AI proxy:', error);
    return c.json({
      success: false,
      error: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    }, 500);
  }
});

export default app;