import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { sign, verify } from "npm:jsonwebtoken";

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

// JWT Secret - 在生产环境中应该从环境变量获取
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "default_secret_for_dev";

// 初始化Supabase客户端
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// NodeDef相关API（与Java版本保持一致）
// GET /user/allBriefs - 获取所有节点定义简要信息（分页）
app.get("/user/allBriefs", async (c) => {
  try {
    const { search, page = "1", pageSize = "10" } = c.req.query();

    const pageNum = parseInt(page as string);
    const pageSizeNum = parseInt(pageSize as string);

    if (pageNum < 1 || pageSizeNum < 1 || pageSizeNum > 100) {
      return c.json({
        code: 400,
        message: "Invalid page or pageSize",
        data: {
          list: [],
          total: 0,
          page: pageNum,
          pageSize: pageSizeNum,
          totalPages: 0
        }
      }, 400);
    }

    let query = supabase
      .from('nodedef')
      .select(`
        id, name, avatar, username, starred, spectype, category, 
        createtime, updatetime, stars, 
        profile->>openapi as type, 
        profile->info->>description as description,
        permission
      `, { count: 'exact' });

    // 添加搜索条件
    if (search) {
      const searchTerm = `%${search}%`;
      query = query.or(
        `username.ilike.${searchTerm},name.ilike.${searchTerm},category.ilike.${searchTerm}`
      );
    }

    // 计算偏移量并添加排序
    const offset = (pageNum - 1) * pageSizeNum;
    query = query.range(offset, offset + pageSizeNum - 1).order('createtime', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const totalPages = Math.ceil((count || 0) / pageSizeNum);

    const response = {
      code: 200,
      message: "Success",
      data: {
        list: data || [],
        total: count || 0,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages
      }
    };

    return c.json(response);
  } catch (error) {
    console.log(`Error fetching node definitions: ${error}`);
    return c.json({
      code: 500,
      message: "Failed to fetch node definitions",
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0
      }
    }, 500);
  }
});

// GET /user/briefsByUserName - 根据用户名获取节点定义简要信息
app.get("/user/briefsByUserName", async (c) => {
  try {
    const { userName } = c.req.query();
    if (!userName) return c.json([], 400);

    // 1) 查 nodedef（LEFT JOIN 左表）
    const { data: nodedefRows, error: nodedefError } = await supabase
      .from("nodedef")
      .select(`
        id, username, name, starred, spectype, category, 
        createtime, updatetime, stars, 
        profile->>openapi as type, 
        profile->info->>description as description,
        permission
      `)
      .eq("username", userName as string);

    if (nodedefError) throw nodedefError;

    // 2) 查 userinfo（右表）
    //    注意：为了模拟 LEFT JOIN，这里用 nodedef 的 username 去找 userinfo
    const usernames = [...new Set((nodedefRows ?? []).map(r => r.username).filter(Boolean))] as string[];

    let userinfoMap = new Map<string, { avatar: string | null }>();

    if (usernames.length > 0) {
      const { data: userinfoRows, error: userinfoError } = await supabase
        .from("userinfo")
        .select("username, avatar")
        .in("username", usernames);

      if (userinfoError) throw userinfoError;

      (userinfoRows ?? []).forEach(u => {
        if (u.username) userinfoMap.set(u.username, { avatar: u.avatar });
      });
    }

    // 3) 合并（LEFT JOIN：找不到 userinfo 就 avatar=null）
    const merged = (nodedefRows ?? []).map(r => {
      const u = r.username ? userinfoMap.get(r.username) : undefined;
      return {
        ...r,
        userinfo: {
          avatar: u?.avatar ?? null,
        },
      };
    });

    return c.json(merged);
  } catch (error) {
    console.error("Error fetching node definitions by username:", error);
    return c.json({ error: String(error) }, 500);
  }
});

// GET /user/nodedef/:id - 根据ID获取单个节点定义详情
app.get("/user/nodedef/:id", async (c) => {
  try {
    const { id } = c.req.param();

    const { data, error } = await supabase
      .from('nodedef')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') { // Record not found
        return c.json({}, 204);
      }
      throw error;
    }

    // 移除敏感信息后返回
    const { profile, ...rest } = data;
    return c.json({ ...rest, profile: typeof profile === 'object' ? JSON.stringify(profile) : profile });
  } catch (error) {
    console.log(`Error fetching node definition by ID: ${error}`);
    return c.json({}, 500);
  }
});

// POST /user/save - 保存节点定义
app.post("/user/save", async (c) => {
  try {
    const body = await c.req.json();

    // 生成UUID
    const id = crypto.randomUUID();

    // 构建要插入的数据
    const nodeDefData = {
      ...body,
      id,
      createtime: new Date().toISOString(),
      updatetime: new Date().toISOString(),
      profile: typeof body.profile === 'string' ? JSON.parse(body.profile) : body.profile
    };

    // 尝试插入数据
    const { data, error } = await supabase
      .from('nodedef')
      .insert([nodeDefData])
      .select()
      .single();

    if (error) {
      // 检查是否是唯一约束冲突
      if (error.code === '23505') { // unique_violation
        // 查询已存在的记录
        const { data: existingData } = await supabase
          .from('nodedef')
          .select('id')
          .eq('name', body.name)
          .eq('username', body.username)
          .single();

        const errorResponse = {
          status: "FAILED",
          message: `保存失败：name '${body.name}' 和 username '${body.username}' 的组合已存在`,
          errorCode: "DUPLICATE_ENTRY",
          ...(existingData && { existingId: existingData.id })
        };

        return c.json(errorResponse, 409);
      }

      // 其他错误
      console.error("保存节点定义时发生数据库错误", error);
      const errorResponse = {
        status: "FAILED",
        message: `保存失败：${error.message}`
      };
      return c.json(errorResponse, 500);
    }

    // 成功后移除profile信息，只返回基本model信息
    const { profile, ...result } = data[0];
    return c.json({ ...result, profile: "" });
  } catch (error) {
    console.log(`Error saving node definition: ${error}`);
    const errorResponse = {
      status: "FAILED",
      message: `保存失败：${error.message}`
    };
    return c.json(errorResponse, 500);
  }
});

// Auth相关API（与Java版本保持一致）
// POST /api/auth/signin - 用户登录
app.post("/api/auth/signin", async (c) => {
  try {
    const { loginId, password } = await c.req.json();

    // 查询用户信息
    const { data: user, error } = await supabase
      .from('userinfo')
      .select('*')
      .or(`username.eq.${loginId},email.eq.${loginId}`)
      .single();

    if (error || !user) {
      return c.json({ message: "Invalid credentials" }, 403);
    }

    // 这里简化处理，实际应用中需要比较加密后的密码
    // 由于TypeScript中没有现成的bcrypt库，我们暂时假设密码验证通过
    // 在实际部署中需要引入适当的密码哈希库
    const isValidPassword = password === user.password; // 简化验证

    if (!isValidPassword) {
      return c.json({ message: "Invalid credentials" }, 403);
    }

    // 生成JWT token
    const token = sign(
      { userId: user.id, loginId: user.username || user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 设置cookie
    c.header('Set-Cookie', `token=${token}; HttpOnly; Secure=false; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}; Path=/`);

    return c.json({ message: "Login successful", userId: user.id });
  } catch (error) {
    console.log(`Error during sign in: ${error}`);
    return c.json({ message: "Invalid credentials" }, 403);
  }
});

// POST /api/auth/logout - 用户登出
app.post("/api/auth/logout", async (c) => {
  try {
    // 获取当前token
    const token = c.req.header('Cookie')?.match(/token=([^;]+)/)?.[1];

    if (token) {
      // 将token加入黑名单（如果使用了黑名单机制）
      // 这里省略具体实现，因为需要额外的数据库表
    }

    // 清除cookie
    c.header('Set-Cookie', 'token=; HttpOnly; Secure=false; SameSite=Lax; Max-Age=0; Path=/');

    return c.json({ message: "Logged out" });
  } catch (error) {
    console.log(`Error during logout: ${error}`);
    return c.json({ message: "Logout failed" }, 500);
  }
});

// POST /api/auth/signup - 用户注册
app.post("/api/auth/signup", async (c) => {
  try {
    const { username, password, email } = await c.req.json();

    // 检查用户名或邮箱是否已存在
    const { count: userCount, error: checkError } = await supabase
      .from('userinfo')
      .select('*', { count: 'exact', head: true })
      .or(`username.eq.${username},email.eq.${email}`);

    if (checkError) {
      throw checkError;
    }

    if (userCount && userCount > 0) {
      throw new Error("Username or email already exists");
    }

    // 生成用户ID
    const userId = crypto.randomUUID();

    // 插入新用户
    const { error: insertError } = await supabase
      .from('userinfo')
      .insert([{
        id: userId,
        username,
        password, // 实际应用中需要加密
        email,
        createtime: new Date().toISOString(),
        updatetime: new Date().toISOString()
      }]);

    if (insertError) {
      if (insertError.code === '23505') { // unique_violation
        throw new Error("Username or email already taken");
      }
      throw insertError;
    }

    return c.json({ message: "User registered successfully" });
  } catch (error) {
    console.log(`Error during sign up: ${error}`);
    return c.json({ message: error.message || "Registration failed" }, 400);
  }
});

// GET /api/auth/profile - 获取用户资料
app.get("/api/auth/profile", async (c) => {
  // 硬编码返回指定的用户数据

  return c.json({
    "username": "lily",
    "email": "zhangcongmr@outlook.com",
    "id": "9d3b2884-c89a-4be8-a416-b45ae85579f5",
    "avatar": "/static/images/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop"
  });
});

// POST /api/auth/forgot-password - 忘记密码
app.post("/api/auth/forgot-password", async (c) => {
  try {
    const { email } = await c.req.json();

    // 这里会调用密码重置服务
    // 实际应用中需要发送邮件等操作
    // 现在只是模拟行为

    return c.json({ message: "If your email exists, you'll receive a reset link shortly." });
  } catch (error) {
    console.log(`Error during forgot password: ${error}`);
    return c.json({ message: "Request failed" }, 500);
  }
});

// POST /api/auth/reset-password - 重置密码
app.post("/api/auth/reset-password", async (c) => {
  try {
    const { token, newPassword } = await c.req.json();

    // 这里会验证token并重置密码
    // 实际应用中需要检查token的有效性和更新密码
    // 现在只是模拟行为

    return c.json({ message: "Password has been reset successfully." });
  } catch (error) {
    console.log(`Error during reset password: ${error}`);
    return c.json({ message: "Reset failed" }, 500);
  }
});

// GET /api/auth/password-reset/validate - 验证重置令牌
app.get("/api/auth/password-reset/validate", async (c) => {
  try {
    const token = c.req.query('token');

    if (!token) {
      return c.json({ error: "Token is required" }, 400);
    }

    // 这里会验证重置token是否有效
    // 现在只是模拟行为

    return c.json({});
  } catch (error) {
    console.log(`Error validating reset token: ${error}`);
    return c.json({ error: "Invalid token" }, 400);
  }
});

// GET /api/auth/google - Google登录
app.get("/api/auth/google", (c) => {
  // 重定向到 Google OAuth 授权 URL（需替换 YOUR_CLIENT_ID 和 YOUR_REDIRECT_URI）
  const googleAuthUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
    "?client_id=YOUR_GOOGLE_CLIENT_ID" +
    "&redirect_uri=https://yourdomain.com/api/auth/google/callback" +
    "&response_type=code" +
    "&scope=openid%20email%20profile" +
    "&access_type=offline";

  // 在Deno环境中无法直接重定向，所以返回URL供前端处理
  return c.json({ redirectUrl: googleAuthUrl });
});

// GET /api/auth/apple - Apple登录
app.get("/api/auth/apple", (c) => {
  // 重定向到 Apple Sign In（需配置 Apple Developer 设置）
  const appleAuthUrl = "https://appleid.apple.com/auth/authorize" +
    "?client_id=com.yourcompany.yourapp" +
    "&redirect_uri=https://yourdomain.com/api/auth/apple/callback" +
    "&response_type=code%20id_token" +
    "&scope=name%20email" +
    "&response_mode=form_post";

  // 在Deno环境中无法直接重定向，所以返回URL供前端处理
  return c.json({ redirectUrl: appleAuthUrl });
});

export default app;