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

// 在启动时确保avatars bucket存在
const initializeStorage = async () => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const avatarsBucketExists = buckets?.some(bucket => bucket.name === 'make-1334fc59-avatars');

    if (!avatarsBucketExists) {
      const { error } = await supabase.storage.createBucket('make-1334fc59-avatars', {
        public: true,
        fileSizeLimit: 5242880 // 5MB
      });

      if (error) {
        console.error('Error creating avatars bucket:', error);
      } else {
        console.log('Avatars bucket created successfully');
      }
    }
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
};

// 初始化存储
initializeStorage();

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

// POST /user/avatar/{id} - 更新用户头像
app.post("/user/avatar/:id", async (c) => {
  try {
    const { id } = c.req.param();
    const reqText = await c.req.text(); // 获取纯文本请求体
    let avatarUrl = reqText;

    // 如果请求体是JSON格式，则解析出avatarUrl
    try {
      const parsed = JSON.parse(reqText);
      avatarUrl = typeof parsed === 'string' ? parsed : parsed.avatarUrl;
    } catch (e) {
      // 如果不是JSON格式，保持原始reqText作为avatarUrl
    }

    // 更新头像
    const { error } = await supabase
      .from('userinfo')
      .update({ avatar: avatarUrl })
      .eq('id', id);

    if (error) {
      console.error("Error updating user avatar:", error);
      return c.json({ error: error.message }, 500);
    }

    return c.json({ message: "Avatar updated successfully" });
  } catch (error) {
    console.log(`Error updating user avatar: ${error}`);
    return c.json({ error: error.message }, 500);
  }
});

// POST /user/avatar/signed-url - Generate a signed upload URL for avatar upload
app.post("/user/avatar/signed-url", async (c) => {
  try {
    const { fileName, fileType, userId } = await c.req.json();

    if (!fileName || !fileType) {
      return c.json({
        success: false,
        message: "fileName and fileType are required"
      }, 400);
    }

    // 验证文件类型
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(fileType)) {
      return c.json({
        success: false,
        message: "Invalid file type. Only images are allowed."
      }, 400);
    }

    const bucketName = 'make-1334fc59-avatars';
    const fileExt = fileName.split('.').pop()?.toLowerCase() || 'jpg';
    const uniqueFileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = userId ? `${userId}/${uniqueFileName}` : `avatars/${uniqueFileName}`;

    // 生成上传所需的签名信息
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    return c.json({
      success: true,
      uploadUrl: `${supabaseUrl}/storage/v1/upload/resumable`,
      bucketName: bucketName,
      filePath: filePath,
      token: serviceRoleKey, // 使用service role key进行上传
      publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucketName}/${filePath}`
    });

  } catch (error) {
    console.error("Error generating signed URL:", error);
    return c.json({
      success: false,
      message: `Failed to generate upload URL: ${error.message}`
    }, 500);
  }
});

// POST /user/api/upload - 文件上传
// 注意：Hono在Edge环境下处理multipart表单的方式有限
// 实际应用中可能需要专门的文件上传服务或预签名URL
app.post("/user/api/upload", async (c) => {
  try {
    // 在Supabase Edge Functions中处理文件上传比较复杂
    // 这里提供一个概念验证，实际实现需要考虑更多细节
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;

    if (!file) {
      return c.json({
        success: false,
        message: "No file uploaded",
        fileUrl: null,
        filename: null
      }, 400);
    }

    // 检查文件类型
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return c.json({
        success: false,
        message: "Invalid file type. Only images are allowed.",
        fileUrl: null,
        filename: null
      }, 400);
    }

    // 检查文件大小 (5MB限制)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({
        success: false,
        message: "File size exceeds 5MB limit",
        fileUrl: null,
        filename: null
      }, 400);
    }

    // 生成唯一的文件名
    const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = userId ? `${userId}/${fileName}` : fileName;

    // 上传到Supabase Storage
    const { data, error: uploadError } = await supabase
      .storage
      .from('avatars') // 假设使用名为avatars的bucket
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      if (uploadError.code === 'PGRST300') { // 文件已存在
        // 删除已存在的文件然后重新上传
        await supabase.storage.from('avatars').remove([data?.path]);
        const { data: newData, error: retryError } = await supabase
          .storage
          .from('avatars')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true
          });

        if (retryError) {
          console.error("Error re-uploading file to storage:", retryError);
          return c.json({
            success: false,
            message: `File upload failed: ${retryError.message}`,
            fileUrl: null,
            filename: null
          }, 500);
        }

        data = newData;
      } else {
        console.error("Error uploading file to storage:", uploadError);
        return c.json({
          success: false,
          message: `File upload failed: ${uploadError.message}`,
          fileUrl: null,
          filename: null
        }, 500);
      }
    }

    // 生成公开URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('avatars')
      .getPublicUrl(data.path);

    // 如果提供了用户ID，更新用户头像
    if (userId) {
      await supabase
        .from('userinfo')
        .update({ avatar: publicUrl })
        .eq('id', userId);
    }

    return c.json({
      success: true,
      message: "File uploaded successfully to Supabase Storage",
      fileUrl: publicUrl,
      filename: file.name
    });
  } catch (error) {
    console.log(`File upload failed: ${error}`);
    return c.json({
      success: false,
      message: `File upload failed: ${error.message}`,
      fileUrl: null,
      filename: null
    }, 500);
  }
});

// GET /user/api/download/{fileName} - 文件下载
// 注意：Supabase Edge Functions不适合做文件代理，建议直接使用Storage的公开URL
app.get("/user/api/download/:fileName", async (c) => {
  const { fileName } = c.req.param();
  const userId = c.req.query('userId');

  try {
    // 构造对象键
    const objectKey = userId ? `${userId}/${fileName}` : fileName;

    // 获取文件的临时公开URL
    const { data, error } = supabase
      .storage
      .from('files') // 假设使用名为files的bucket
      .createSignedUrl(objectKey, 60); // 1分钟有效期

    if (error) {
      console.error("Error getting signed URL:", error);
      return c.json({ error: "File not found" }, 404);
    }

    // 重定向到临时URL
    return c.redirect(data.signedUrl);
  } catch (error) {
    console.error(`File download failed for fileName: ${fileName}`, error);
    return c.json({ error: `Download failed: ${error.message}` }, 500);
  }
});

// GET /user/api/file-info/{fileName} - 获取文件信息
app.get("/user/api/file-info/:fileName", async (c) => {
  const { fileName } = c.req.param();
  const userId = c.req.query('userId');

  try {
    const objectKey = userId ? `${userId}/${fileName}` : fileName;

    // 尝试获取对象的元数据
    const { data: objectData, error: objectError } = await supabase
      .storage
      .from('files')
      .download(objectKey); // 获取文件元数据

    if (objectError) {
      console.error("Error accessing file:", objectError);
      return c.json({
        success: false,
        message: "File not found",
        fileUrl: null,
        filename: null,
        size: 0
      }, 404);
    }

    // 获取文件的公开URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('files')
      .getPublicUrl(objectKey);

    return c.json({
      success: true,
      message: "File found",
      fileUrl: publicUrl,
      filename: fileName,
      size: objectData.size ?? 0
    });
  } catch (error) {
    console.error(`Failed to get file info for fileName: ${fileName}`, error);
    return c.json({
      success: false,
      message: `Error: ${error.message}`,
      fileUrl: null,
      filename: null,
      size: 0
    }, 500);
  }
});

// GET /user/api/blob-url/{fileName} - 获取文件的blob URL
app.get("/user/api/blob-url/:fileName", async (c) => {
  const { fileName } = c.req.param();
  const userId = c.req.query('userId');
  const expiresInParam = c.req.query('expiresIn');
  const expiresIn = expiresInParam ? parseInt(expiresInParam as string) : 3600; // 默认3600秒

  try {
    const objectKey = userId ? `${userId}/${fileName}` : fileName;

    // 创建带过期时间的签名URL
    const { data, error } = supabase
      .storage
      .from('files')
      .createSignedUrl(objectKey, expiresIn);

    if (error) {
      console.error("Error generating signed URL:", error);
      return c.json({ success: false, message: "Error: " + error.message, url: null }, 500);
    }

    return c.json({
      success: true,
      message: "Blob URL generated successfully",
      blobUrl: data.signedUrl
    });
  } catch (error) {
    console.error(`Failed to generate blob URL for fileName: ${fileName}`, error);
    return c.json({ success: false, message: `Error: ${error.message}`, blobUrl: null }, 500);
  }
});

// POST /user/api/upload-folder - 上传文件夹功能
app.post("/user/api/upload-folder", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const userId = formData.get('userId') as string | null;
    const relativePath = formData.get('relativePath') as string | null;

    if (!file) {
      return c.json({
        success: false,
        message: "No file uploaded",
        url: null,
        filename: null
      }, 400);
    }

    // 检查文件类型和大小
    if (file.size > 10 * 1024 * 1024) { // 10MB限制
      return c.json({
        success: false,
        message: "File too large",
        url: null,
        filename: null
      }, 400);
    }

    // 生成唯一的文件名
    const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
    const fileName = `${crypto.randomUUID()}.${fileExt}`;

    // 构建完整的路径
    let filePath = fileName;
    if (userId) {
      filePath = `${userId}/${filePath}`;
    }
    if (relativePath) {
      filePath = `${relativePath}/${filePath}`;
    }

    // 上传到Supabase Storage
    const { data, error: uploadError } = await supabase
      .storage
      .from('files') // 使用files bucket
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      if (uploadError.code === 'PGRST300') { // 文件已存在
        // 删除已存在的文件然后重新上传
        await supabase.storage.from('files').remove([data?.path]);
        const { data: newData, error: retryError } = await supabase
          .storage
          .from('files')
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true
          });

        if (retryError) {
          console.error("Error re-uploading file to storage:", retryError);
          return c.json({
            success: false,
            message: `Upload failed: ${retryError.message}`,
            url: null,
            filename: null
          }, 500);
        }

        data = newData;
      } else {
        console.error("Error uploading file to storage:", uploadError);
        return c.json({
          success: false,
          message: `Upload failed: ${uploadError.message}`,
          url: null,
          filename: null
        }, 500);
      }
    }

    // 生成公开URL
    const { data: { publicUrl } } = supabase
      .storage
      .from('files')
      .getPublicUrl(data.path);

    return c.json({
      success: true,
      message: "File uploaded successfully to Supabase Storage",
      url: publicUrl,
      filename: file.name
    });
  } catch (error) {
    console.log(`Folder upload failed: ${error}`);
    return c.json({
      success: false,
      message: `Upload failed: ${error.message}`,
      url: null,
      filename: null
    }, 500);
  }
});

// POST /user/fork/{sourceRootDir} - Fork仓库功能
app.post("/user/fork/:sourceRootDir", async (c) => {
  const { sourceRootDir } = c.req.param();
  const sourceUserName = c.req.query('sourceUserName') as string;
  const destUserName = c.req.query('destUserName') as string;

  try {
    // 参数验证
    if (!sourceRootDir || sourceRootDir.length === 0) {
      return c.json({
        success: false,
        message: "Source root directory cannot be empty"
      }, 400);
    }

    if (!destUserName || destUserName.length === 0) {
      return c.json({
        success: false,
        message: "Destination user name cannot be empty"
      }, 400);
    }

    if (!sourceUserName || sourceUserName.length === 0) {
      return c.json({
        success: false,
        message: "Source user name cannot be empty"
      }, 400);
    }

    // 防止目录遍历攻击
    if (sourceRootDir.includes("..") || sourceRootDir.includes("/") || sourceRootDir.includes("\\")) {
      return c.json({
        success: false,
        message: "Invalid source root directory name"
      }, 400);
    }

    // 获取源目录的所有文件
    const { data: sourceFiles, error: listError } = await supabase
      .storage
      .from('projects') // 假设使用名为projects的bucket存储项目文件
      .list(`${sourceUserName}/${sourceRootDir}`, {
        limit: 1000, // 假设不超过1000个文件
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      });

    if (listError) {
      console.error("Error listing source directory:", listError);
      return c.json({
        success: false,
        message: `Source directory not found: ${sourceUserName}/${sourceRootDir}`
      }, 404);
    }

    if (!sourceFiles || sourceFiles.length === 0) {
      return c.json({
        success: false,
        message: `Source directory is empty: ${sourceUserName}/${sourceRootDir}`
      }, 400);
    }

    // 检查目标目录是否已存在
    const { data: destFiles, error: destListError } = await supabase
      .storage
      .from('projects')
      .list(`${destUserName}/${sourceRootDir}`, {
        limit: 1,
        offset: 0,
      });

    if (destListError && destListError.code !== 'StorageUnknownError') {
      // 如果错误不是"目录不存在"，则返回错误
      console.error("Error checking destination directory:", destListError);
      return c.json({
        success: false,
        message: `Error checking destination directory: ${destListError.message}`
      }, 500);
    }

    if (destFiles && destFiles.length > 0) {
      return c.json({
        success: false,
        message: `Target directory already exists: ${destUserName}/${sourceRootDir}`
      }, 409);
    }

    // 复制所有文件
    for (const fileObj of sourceFiles) {
      // 下载源文件
      const { data: fileData, error: downloadError } = await supabase
        .storage
        .from('projects')
        .download(`${sourceUserName}/${sourceRootDir}/${fileObj.name}`);

      if (downloadError) {
        console.error(`Error downloading file ${fileObj.name}:`, downloadError);
        return c.json({
          success: false,
          message: `Error downloading file: ${fileObj.name}`
        }, 500);
      }

      // 上传到目标位置
      const { error: uploadError } = await supabase
        .storage
        .from('projects')
        .upload(`${destUserName}/${sourceRootDir}/${fileObj.name}`, fileData, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error(`Error uploading file ${fileObj.name} to destination:`, uploadError);
        return c.json({
          success: false,
          message: `Error copying file: ${fileObj.name}`
        }, 500);
      }
    }

    console.log(`Repository forked successfully: ${sourceUserName}/${sourceRootDir} -> ${destUserName}/${sourceRootDir}`);

    // 返回成功响应
    return c.json({
      success: true,
      message: "Repository forked successfully",
      sourcePath: `${sourceUserName}/${sourceRootDir}`,
      destPath: `${destUserName}/${sourceRootDir}`
    });
  } catch (error) {
    console.error(`Failed to fork repository: ${sourceRootDir}`, error);
    return c.json({
      success: false,
      message: `Failed to fork repository: ${error.message}`
    }, 500);
  }
});

export default app;