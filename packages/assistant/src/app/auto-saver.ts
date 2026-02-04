import { queuedWrite } from "./core.service";

// auto-saver.ts
export class AutoSaver {

  private intervalId: number | null = null;
  private readonly filePath: string;
  private readonly getData: () => string;
  private readonly intervalMs: number;

  constructor(
    filePath: string,
    getData: () => string,
    intervalMs: number = 5000
  ) {
    this.filePath = filePath;
    this.getData = getData;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.intervalId !== null) {
    //   console.warn(`[AutoSaver] Already running for ${this.filePath}`);
      return;
    }

    // 立即保存一次（可选）
    this.save();

    this.intervalId = window.setInterval(() => {
      this.save();
    }, this.intervalMs);

    // console.log(`[AutoSaver] Started for ${this.filePath} every ${this.intervalMs}ms`);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    //   console.log(`[AutoSaver] Stopped for ${this.filePath}`);
    }
  }

  private save(): void {
    try {
      const data = this.getData();
      queuedWrite(this.filePath, data)
        // .then(() => console.log(`[AutoSaver] Saved ${this.filePath}`))
        .catch(err => console.error(`[AutoSaver] Failed to save ${this.filePath}:`, err));
    } catch (err) {
      console.error(`[AutoSaver] Serialization error for ${this.filePath}:`, err);
    }
  }
}