
export interface ApiBriefDocument {
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
}
