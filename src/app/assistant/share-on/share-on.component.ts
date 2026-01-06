import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { CoreService } from '../../core.service';

@Component({
  selector: 'share-on',
  templateUrl: './share-on.component.html',
  styleUrls: ['./share-on.component.css'],
  standalone: true,
  imports: [AstModalComponent]
})
export class ShareOnComponent {
  @Input() visible = false;
  @Input() data: any;
  @Output() close = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();

  private coreService = inject(CoreService);

  private serverDataUrl = 'https://127.0.0.1:8980/user/save'

  onClose(): void {
    this.visible = false;
    this.close.emit();
  }

  confirmShare(): void {
    this.data['dataType'] = "projectType"
    this.data['info'] = this.data['info'] || {};
    this.data['info']['title'] = this.data.label || "Untitled API";
    this.data['openapi'] = "3.0.0";
    this.data['info']['description'] = "Shared from API Assistant";
    this.coreService.reset([this.data], true);  
    this.coreService.postData(this.serverDataUrl, JSON.stringify(this.data));
    this.share.emit();
    this.onClose();
  }
}
