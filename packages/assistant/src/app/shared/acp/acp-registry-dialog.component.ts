import { Component, inject, input, signal, computed, output, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { AstModalComponent } from "../ast-modal/ast-modal.component";

export interface AcpRegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  authors?: string[];
  license?: string;
  distribution?: any;
  icon?: string;
}

export interface AcpRegistry {
  version: string;
  agents: AcpRegistryAgent[];
}

const REGISTRY_URL = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

/** 骨架屏占位行数（与真实列表的视觉密度接近）。 */
const SKELETON_ROW_COUNT = 7;

/** 骨架屏最短展示时长（ms），避免接口秒回时骨架一闪而过。 */
const MIN_LOADING_DURATION = 350;

@Component({
  selector: "app-acp-registry-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule, AstModalComponent],
  templateUrl: "./acp-registry-dialog.component.html",
  styleUrls: ["./acp-registry-dialog.component.css"],
})
export class AcpRegistryDialogComponent {
  private http = inject(HttpClient);

  /** Parent-controlled visibility. */
  visible = input(false);
  /** Agent ids with a running install — their button shows "Installing...". */
  installingIds = input<string[]>([]);
  /** Agent ids already installed — no button is shown for them. */
  installedIds = input<string[]>([]);
  /** Emitted when the dialog should close (Cancel / close button / backdrop). */
  readonly close = output<void>();
  /** Emitted when the user clicks Install on an agent. */
  readonly install = output<AcpRegistryAgent>();
  /** Emitted when the user clicks OK. */
  readonly ok = output<void>();

  loading = signal(false);
  error = signal<string | null>(null);
  searchQuery = signal("");
  agents = signal<AcpRegistryAgent[]>([]);
  passMcpServers = signal(true);

  /** 骨架屏占位行。 */
  readonly skeletonRows = Array.from(
    { length: SKELETON_ROW_COUNT },
    (_, i) => i
  );

  /** 请求序号，用于丢弃过期的异步回调。 */
  private loadSeq = 0;

  filteredAgents = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.agents();
    return this.agents().filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        (a.authors || []).some((author) => author.toLowerCase().includes(query))
    );
  });

  constructor() {
    // When the parent shows the dialog, load the ACP registry data.
    effect(() => {
      if (this.visible()) {
        this.loadRegistry();
      }
    });
  }

  private loadRegistry(): void {
    const seq = ++this.loadSeq;
    const startedAt = Date.now();

    this.loading.set(true);
    this.error.set(null);
    this.searchQuery.set("");

    this.http.get<AcpRegistry>(REGISTRY_URL).subscribe({
      next: (data) => {
        this.agents.set(data.agents || []);
        this.finishLoading(seq, startedAt);
      },
      error: () => {
        this.error.set("Failed to load ACP registry");
        this.finishLoading(seq, startedAt);
      },
    });
  }

  /**
   * 结束加载态。骨架屏至少展示 MIN_LOADING_DURATION，避免接口秒回时
   * 骨架一闪而过造成闪烁；过期的请求（seq 不匹配）直接忽略。
   */
  private finishLoading(seq: number, startedAt: number): void {
    if (seq !== this.loadSeq) return;

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_LOADING_DURATION - elapsed);

    if (remaining === 0) {
      this.loading.set(false);
      return;
    }

    setTimeout(() => {
      if (seq === this.loadSeq) {
        this.loading.set(false);
      }
    }, remaining);
  }

  closeDialog(): void {
    this.loading.set(false);
    this.error.set(null);
    this.close.emit();
  }

  onAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = "none";
  }
}
