import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { CoreService } from '../../core.service';
import { ApiInfoModel } from '../../shared/model';

@Component({
  selector: 'share-on',
  templateUrl: './share-on.component.html',
  styleUrls: ['./share-on.component.css'],
  standalone: true,
  imports: [AstModalComponent]
})
export class ShareOnComponent {
  @Input() visible = false;
  @Input() data: ApiInfoModel = {};
  @Output() close = new EventEmitter<void>();
  @Output() share = new EventEmitter<void>();

  private coreService = inject(CoreService);

  private serverDataUrl = 'https://127.0.0.1:8980/user/save'

  onClose(): void {
    this.visible = false;
    this.close.emit();
  }

  confirmShare(): void {
    if(this.data && this.data.profile) {
      this.data.name = this.data.profile.label || "Untitled API"
      this.data.createtime = new Date().toISOString();
      this.data.updatetime = new Date().toISOString();
      this.data.username = this.coreService.userData?.username || "Anonymous";


      this.data.profile['dataType'] = "projectType"
      this.data.profile['info'] = this.data.profile['info'] || {};
      this.data.profile['info']['title'] = this.data.profile.label || "Untitled API";
      this.data.profile['openapi'] = "3.0.0";
      this.data.profile['info']['description'] = "Shared from API Luxio";
      this.coreService.reset([this.data.profile], true);

      this.data.profile = JSON.stringify(this.data.profile);
      this.coreService.postData(this.serverDataUrl, this.data);
      this.share.emit();
      this.onClose();
    }
  }
}
