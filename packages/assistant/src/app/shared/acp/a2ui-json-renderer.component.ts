import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SurfaceComponent } from '@a2ui/angular/v0_9';
import { A2uiRendererService } from '@a2ui/angular/v0_9';
import { FormatMessagePipe } from './tool-call-info.pipe';

@Component({
  selector: 'app-a2ui-json-renderer',
  standalone: true,
  imports: [CommonModule, SurfaceComponent, FormatMessagePipe],
  templateUrl: './a2ui-json-renderer.component.html',
  styleUrls: ['./a2ui-json-renderer.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class A2uiJsonRendererComponent {
  content = input<string>('');
  
  protected renderer = inject(A2uiRendererService);
  
  private processed = false;
  
  surfaces = signal<string[]>([]);
  remainingContent = signal<string>('');
  
  constructor() {
    effect(() => {
      const content = this.content();
      if (content && !this.processed) {
        this.tryProcessContent(content);
      }
    });
  }
  
  private tryProcessContent(content: string): void {
    const regex = /<a2ui-json>([\s\S]*?)<\/a2ui-json>/g;
    const completeBlocks: string[] = [];
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      completeBlocks.push(match[1]);
    }
    
    if (completeBlocks.length > 0) {
      this.processed = true;
      
      const allMessages: any[] = [];
      const surfaceIds = new Set<string>();
      
      for (const block of completeBlocks) {
        try {
          const jsonArray = JSON.parse(block);
          for (const item of jsonArray) {
            allMessages.push(item);
            if (item.createSurface?.surfaceId) {
              surfaceIds.add(item.createSurface.surfaceId);
            }
          }
        } catch (e) { /* ignore invalid JSON */ }
      }
      
      // Delete existing surfaces with same IDs to avoid conflicts
      const surfaceGroup = this.renderer.surfaceGroup;
      for (const surfaceId of surfaceIds) {
        if (surfaceGroup.surfacesMap.has(surfaceId)) {
          surfaceGroup.deleteSurface(surfaceId);
        }
      }
      
      if (allMessages.length > 0) {
        this.renderer.processMessages(allMessages);
      }
      
      this.surfaces.set(Array.from(surfaceIds));
      this.remainingContent.set(content.replace(regex, '').trim());
    }
  }
}