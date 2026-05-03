import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

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

// 初始化Supabase客户端
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);


// GET /user/info/{id} - 获取用户信息
app.get("/user/info/:id", async (c) => {
  try {
    const { id } = c.req.param();

    // 查询用户信息
    const { data: user, error } = await supabase
      .from('userinfo')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Record not found
        return c.json({});
      }
      throw error;
    }

    return c.json(user);
  } catch (error) {
    console.log(`Error fetching user info by ID: ${error}`);
    return c.json({}, 500);
  }
});

export default app;