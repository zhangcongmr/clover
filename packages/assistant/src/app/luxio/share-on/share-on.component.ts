import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { CoreService } from '../../core.service';
import { NodeDef } from "@luxio/common";

@Component({
  selector: 'share-on',
  templateUrl: './share-on.component.html',
  styleUrls: ['./share-on.component.css'],
  standalone: true,
  imports: [FormsModule, AstModalComponent]
})
export class ShareOnComponent {
  @Input() visible = false;
  @Input() data: NodeDef = {};
  @Output() close = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();

  private coreService = inject(CoreService);

  private serverDataUrl = '/user/save'

  onClose(): void {
    this.visible = false;
    this.close.emit();
  }

  confirmShare(): void {
    if(this.data && this.data.profile) {
      this.coreService.postData(this.serverDataUrl, this.data);
      this.share.emit();
      this.onClose();
    }
  }
}
