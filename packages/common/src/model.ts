
export interface NodeDef {
  id?: string;
  avatar?: string | null;
  username?: string;
  name?: string;
  starred?: boolean;
  type?: string; // e.g. "3.1.0"
  description?: string;
  specType?: string | null;
  specColor?: string | null;
  category?: string | null;
  createtime?: string;
  updatetime?: string;
  stars?: number | null;
  profile?: string; // 或者如果 profile 应该是对象，可改为 Record<string, any> 或具体接口
}

export interface OpenApiV3Document {
  openapi: string;
  info: any;
  servers?: [];
  paths: any;
  components?: any;
  security?: [];
  tags?: [];
  externalDocs?: any;
}

export interface User {
  id?: string;
  username?: string;
  name?: string;
  email?: string;
  avatar?: string;
  // 添加其他用户字段根据需要
}