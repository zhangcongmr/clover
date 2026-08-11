import Redis, { type RedisOptions } from 'ioredis';

export interface RedisConfig {
  host?: string;
  port?: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  useMemoryFallback?: boolean;
  /**
   * Redis 协议版本
   * - 2: RESP2 (兼容旧版 Redis)
   * - 3: RESP3 (默认，需要 Redis 6.0+)
   * @default 2
   */
  protocol?: 2 | 3;
}

export class RedisClient {
  private static instance: RedisClient | null = null;
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private connections: Map<string, Set<(message: string) => void>> = new Map();
  private isReady = false;
  private useMemoryFallback: boolean = false;
  private memoryStore: Map<string, string> = new Map();

  private constructor(config: RedisConfig = {}) {
    this.useMemoryFallback = config.useMemoryFallback || 
      process.env.REDIS_USE_MEMORY_FALLBACK !== 'false'; // Default to memory mode

    if (this.useMemoryFallback) {
      console.log('[Redis] Running in memory fallback mode (no Redis required)');
      this.isReady = true;
      return;
    }

    const redisConfig: RedisOptions = {
      host: config.host || process.env.REDIS_HOST || 'localhost',
      port: config.port || parseInt(process.env.REDIS_PORT || '6379'),
      password: config.password || process.env.REDIS_PASSWORD,
      db: config.db || parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: config.keyPrefix,
      // ioredis 6.x 默认使用 RESP3，设置 protocol: 2 以兼容旧版 Redis
      protocol: (config.protocol || parseInt(process.env.REDIS_PROTOCOL || '2')) as 2 | 3,
      retryStrategy: (times: number) => {
        if (times > 10) {
          console.error('[Redis] Max reconnection attempts reached, falling back to memory mode');
          this.useMemoryFallback = true;
          this.isReady = true;
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
    };

    this.publisher = new Redis(redisConfig);
    this.subscriber = this.publisher.duplicate();

    console.log(`[Redis] Connecting with protocol: RESP${redisConfig.protocol}`);
    this.setupEventHandlers();
  }

  private getPublisher(): Redis {
    if (!this.publisher) {
      throw new Error('[Redis] Publisher not initialized');
    }
    return this.publisher;
  }

  private getSubscriber(): Redis {
    if (!this.subscriber) {
      throw new Error('[Redis] Subscriber not initialized');
    }
    return this.subscriber;
  }

  private setupEventHandlers(): void {
    if (this.useMemoryFallback) {
      return;
    }

    const publisher = this.getPublisher();
    const subscriber = this.getSubscriber();

    publisher.on('connect', () => {
      console.log('[Redis] Publisher connected');
    });

    publisher.on('ready', () => {
      this.isReady = true;
      console.log('[Redis] Publisher ready');
    });

    publisher.on('error', (err) => {
      console.error('[Redis] Publisher error:', err.message);
    });

    subscriber.on('connect', () => {
      console.log('[Redis] Subscriber connected');
    });

    subscriber.on('error', (err) => {
      console.error('[Redis] Subscriber error:', err.message);
    });

    subscriber.on('message', (channel, message) => {
      const handlers = this.connections.get(channel);
      if (handlers) {
        handlers.forEach(handler => handler(message));
      }
    });
  }

  static getInstance(config?: RedisConfig): RedisClient {
    if (!RedisClient.instance) {
      RedisClient.instance = new RedisClient(config);
    }
    return RedisClient.instance;
  }

  static resetInstance(): void {
    if (RedisClient.instance) {
      RedisClient.instance.disconnect();
      RedisClient.instance = null;
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    if (!this.isReady) {
      throw new Error('[Redis] Publisher not ready');
    }

    if (this.useMemoryFallback) {
      // 内存模式：直接触发所有订阅者的回调
      const handlers = this.connections.get(channel);
      if (handlers) {
        handlers.forEach(handler => handler(message));
      }
      return 1;
    }

    return this.getPublisher().publish(channel, message);
  }

  subscribe(channel: string, handler: (message: string) => void): () => void {
    if (!this.connections.has(channel)) {
      this.connections.set(channel, new Set());
      if (!this.useMemoryFallback) {
        this.getSubscriber().subscribe(channel);
      }
    }
    this.connections.get(channel)!.add(handler);

    return () => {
      this.unsubscribe(channel, handler);
    };
  }

  private unsubscribe(channel: string, handler: (message: string) => void): void {
    const handlers = this.connections.get(channel);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.connections.delete(channel);
        if (!this.useMemoryFallback) {
          this.getSubscriber().unsubscribe(channel);
        }
      }
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryStore.set(key, value);
      if (ttlSeconds) {
        setTimeout(() => this.memoryStore.delete(key), ttlSeconds * 1000);
      }
      return;
    }

    if (ttlSeconds) {
      await this.getPublisher().setex(key, ttlSeconds, value);
    } else {
      await this.getPublisher().set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemoryFallback) {
      return this.memoryStore.get(key) ?? null;
    }
    return this.getPublisher().get(key);
  }

  async del(...keys: string[]): Promise<number> {
    if (this.useMemoryFallback) {
      let count = 0;
      for (const key of keys) {
        if (this.memoryStore.delete(key)) count++;
      }
      return count;
    }
    return this.getPublisher().del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    if (this.useMemoryFallback) {
      return this.memoryStore.has(key);
    }
    const result = await this.getPublisher().exists(key);
    return result === 1;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  isPublisherReady(): boolean {
    return this.isReady;
  }

  isMemoryMode(): boolean {
    return this.useMemoryFallback;
  }

  async disconnect(): Promise<void> {
    this.connections.clear();
    this.memoryStore.clear();
    
    if (!this.useMemoryFallback) {
      await this.publisher?.quit();
      await this.subscriber?.quit();
    }
    
    this.isReady = false;
  }
}

export default RedisClient;
