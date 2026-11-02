import { Component, computed, effect, input, output, signal, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AstModalComponent } from "../ast-modal/ast-modal.component";
import { FilePickerDialogComponent } from "../file-picker-dialog/file-picker-dialog.component";

/** Confirm 回调携带的请求体（editAgent 存在时为编辑模式，id 不可改）。 */
export interface AddDiskAgentRequest {
  id: string;
  name: string;
  command: string;
  args: string[];
  description: string;
  editing: boolean;
}

/** 预编辑 agent 的最小字段（来自 AgentStatusInfo）。 */
export interface EditDiskAgent {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
}

/** 按空白切分参数，双引号包裹的片段保留为单个参数（引号剥除）。 */
function parseArguments(input: string): string[] {
  const matches = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map(s => s.replace(/^"|"$/g, ''));
}

/** 含空白的参数回填时加引号。 */
function quoteArgument(arg: string): string {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

/** 从可执行文件路径派生 agent id：去扩展名 → 非 [a-z0-9] 转 - → 小写。 */
function sanitizeId(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? 'agent';
  const cleaned = fileName
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned || 'disk-agent';
}

@Component({
  selector: "app-add-agent-from-disk-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule, AstModalComponent, FilePickerDialogComponent],
  templateUrl: "./add-agent-from-disk-dialog.component.html",
  styleUrls: ["./add-agent-from-disk-dialog.component.css"],
})
export class AddAgentFromDiskDialogComponent {
  /** Parent-controlled visibility. */
  readonly visible = input(false);
  /** 编辑模式：传入要编辑的 disk agent（id 固定，其余字段预填）。 */
  readonly editAgent = input<EditDiskAgent | null>(null);
  /** 已存在的 agent id 列表，新增时用于 id 去重。 */
  readonly existingIds = input<string[]>([]);

  readonly close = output<void>();
  readonly confirm = output<AddDiskAgentRequest>();
  /** Emitted when the user clicks Delete in edit mode (payload: agent id). */
  readonly remove = output<string>();

  readonly path = signal('');
  readonly displayName = signal('');
  readonly argumentsText = signal('');

  readonly editing = computed(() => !!this.editAgent());
  readonly canConfirm = computed(() => !!this.path().trim());

  private readonly filePicker = viewChild<FilePickerDialogComponent>('filePicker');

  constructor() {
    // 打开时按模式预填表单（新增清空 / 编辑回填）。
    effect(() => {
      if (!this.visible()) return;
      const agent = this.editAgent();
      if (agent) {
        this.path.set(agent.command);
        this.displayName.set(agent.name);
        this.argumentsText.set((agent.args ?? []).map(quoteArgument).join(' '));
      } else {
        this.path.set('');
        this.displayName.set('');
        this.argumentsText.set('');
      }
    });
  }

  openBrowse(): void {
    this.filePicker()?.openFilePicker('/');
  }

  onFileSelected(result: { path: string; kind: 'folder' | 'file' }): void {
    if (result.kind !== 'file') return;
    this.path.set(result.path);
    // Display Name 默认取文件名（含扩展名），已填写时不覆盖。
    if (!this.displayName().trim()) {
      const fileName = result.path.split(/[\\/]/).pop() ?? result.path;
      this.displayName.set(fileName);
    }
  }

  submit(): void {
    const command = this.path().trim();
    if (!command) return;
    const args = parseArguments(this.argumentsText().trim());
    const description = 'Agent added from disk';

    if (this.editing()) {
      const agent = this.editAgent()!;
      this.confirm.emit({
        id: agent.id,
        name: this.displayName().trim() || agent.name,
        command,
        args,
        description,
        editing: true,
      });
      return;
    }

    // 新增：从文件名派生 id，冲突时追加 -2 / -3 ...
    const taken = new Set(this.existingIds());
    const base = sanitizeId(command);
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;

    this.confirm.emit({
      id,
      name: this.displayName().trim() || command.split(/[\\/]/).pop() || id,
      command,
      args,
      description,
      editing: false,
    });
  }

  /** 编辑模式下删除该 agent：把 id 交给父组件执行卸载（父组件负责确认与刷新列表）。 */
  deleteAgent(): void {
    const agent = this.editAgent();
    if (!agent) return;
    this.remove.emit(agent.id);
  }

  closeDialog(): void {
    this.close.emit();
  }
}
