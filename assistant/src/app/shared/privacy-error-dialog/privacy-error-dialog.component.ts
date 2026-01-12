import { Component, OnInit, inject, viewChild } from '@angular/core';
// import { XPlace } from '@ng-nest/ui/core';
import { AstModalComponent } from '../ast-modal/ast-modal.component';
import { ConfigService, CoreService } from '../../core.service';

@Component({
    selector: 'app-privacy-error-dialog',
    templateUrl: './privacy-error-dialog.component.html',
    styleUrls: ['./privacy-error-dialog.component.css'],
    standalone: true,
    imports: [AstModalComponent]
})
export class PrivacyErrorDialogComponent implements OnInit {
  coreService = inject(CoreService);

  readonly astModal = viewChild(AstModalComponent);
  visible!: boolean;
  // placement!: XPlace;
  url: string| undefined;

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

  ngOnInit() {
    this.coreService.dialogSubject.subscribe((val: any) => {
      if (val.action == "open" && val.id == ConfigService.dialogHttpsInterruptId) {
        this.visible = true;
        this.url = val.data.targetUrl;
      }
    });

    let me = this;
    if(chrome.storage) {
      chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }) => {
        const privacyErrorDialogFlag = changes[ConfigService.privacyErrorDialogFlag];
        if(privacyErrorDialogFlag) {
          if(privacyErrorDialogFlag.oldValue == 0 && privacyErrorDialogFlag.newValue == 1) {
            // me.coreService.forcePrivacyVisitSubject.next(1);
            chrome.storage.local.get("targetHref", (result) => {
              const targetHref = result["targetHref"];
              me.coreService.privacyErrorSettingWindow.postMessage("privacy_error_handle_ok", targetHref);
            });
  
          }
        }
      });
    }
  }

  goToPrivacySettingPage() {
    this.close();
    this.coreService.privacyErrorSettingWindow = window.open(this.url, "", this.getStrWindowFeatures());
    chrome.storage.local.set({ [ConfigService.privacyErrorDialogFlag]: 0 }, function () {
      // let us know it worked
      console.log("V3 Test: initialized test click counter to 0");
    });
  }

  cancel() {
    this.close();
  }

  getStrWindowFeatures() {
    const width = 700;
    const height = 400;
    const deltaLeft = (window.innerWidth - width) * 0.5;
    const deltaTop = (window.innerHeight - height) * 0.5;
    const leftX = window.screenLeft + deltaLeft;
    const topY = window.screenTop + deltaTop;
    return "width=" +width + ",height="+ height + ",left=" + leftX + ",top=" + topY;
  }

}
