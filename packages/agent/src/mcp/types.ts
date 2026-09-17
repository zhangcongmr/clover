export interface McpServerRef {
  name: string;
}

export type McpServerConfig =
  | {
      type: 'stdio';
      name: string;
      description: string;
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'http';
      name: string;
      description: string;
      url: string;
      headers?: Record<string, string>;
    };

export interface McpServersStore {
  servers: Record<string, McpServerConfig>;
}
