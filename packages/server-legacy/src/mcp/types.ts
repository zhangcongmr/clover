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

/**
 * Omit that distributes over a union, so each member keeps its own keys
 * (e.g. `command` for stdio, `url` for http) instead of collapsing to the
 * shared keys only. Used for insert/update payloads that omit `name`.
 */
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/** Insert/update payload: every member of `McpServerConfig` minus `name`. */
export type McpServerConfigInput = DistributiveOmit<McpServerConfig, 'name'>;
