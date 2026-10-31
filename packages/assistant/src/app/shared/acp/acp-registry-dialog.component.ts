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
  /** Emitted when the user clicks Apply. */
  readonly apply = output<void>();

  loading = signal(false);
  error = signal<string | null>(null);
  searchQuery = signal("");
  agents = signal<AcpRegistryAgent[]>([]);
  passMcpServers = signal(true);

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
    this.loading.set(true);
    this.error.set(null);
    this.searchQuery.set("");
    this.http.get<AcpRegistry>(REGISTRY_URL).subscribe({
      next: (data) => {
        this.agents.set(data.agents || []);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Failed to load ACP registry");
        this.loading.set(false);
      },
    });
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
