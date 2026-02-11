import { HttpClient } from '@angular/common/http';
import { Component, EventEmitter, OnInit, Output, inject } from '@angular/core';
import { ConfigService, CoreService } from '../../core.service';
import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';

@Component({
    selector: 'app-authorize',
    templateUrl: './authorize.component.html',
    styleUrls: ['./authorize.component.css'],
    standalone: true,
    imports: [AstModalComponent, FormsModule]
})
export class AuthorizeComponent implements OnInit {
  private coreService = inject(CoreService);
  private http = inject(HttpClient);

  // @Output() afterAuthorized = new EventEmitter();
  visible!: boolean;
  // placement!: XPlace;

  url: string| undefined;

  data: {
    userName: string;
    passwd: string;
  } = { userName: '', passwd: '' };

  isShowTip = false;
  contentTip: string | undefined;

  close() {
    this.visible = false;
  }

  beforeClose = () => {
    // this.msgBox.confirm({
    //   title: '提示',
    //   content: '有未保存的数据，确认关闭吗？',
    //   type: 'warning',
    //   callback: (action: XMessageBoxAction) => {
    //     action === 'confirm' && this.close();
    //   }
    // });
    this.close();
  };

  beforeCloseTipDlg =()=> {
    this.closeTipDlg();
  }

  ngOnInit() {
    // this.coreService.dialogSubject.subscribe((val: any) => {
    //   if (val.action == "open" && val.id == ConfigService.dialogAuthorizeId) {
    //     // this.placement = 'center';
    //     this.visible = true;
    //     this.url = val.data.url;
    //   }
    //   if (val.action == "open" && val.id == ConfigService.dialogTipId) {
    //     // this.placement = 'center';
    //     this.isShowTip = true;
    //     this.contentTip = "Authorize success";
    //   }
    // })
  }

  confirm() {
    let me = this;
    this.coreService.doAuthorize(this.url || '', this.data, (result: number) => {
      if(result == 0) {
        me.close();
      }
      if(result == 1) {
        // this.afterAuthorized.emit({ authorized: true })
        me.close();
      }
    });
  }

  cancel() {
    this.close();
  }

  cancelTipDlg() {
    this.closeTipDlg();
  }

  closeTipDlg() {
    this.isShowTip = false;
  }
}
