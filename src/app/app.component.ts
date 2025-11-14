import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, OnInit, ViewContainerRef, afterNextRender, inject } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService, EventItem, AppEventType } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './assistant/content/content.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [AstTabGroupComponent, AstTabComponent, ContentComponent]
})
export class AppComponent implements OnInit, AfterViewInit {
  private coreService = inject(CoreService);
  viewContainerRef = inject(ViewContainerRef);
  http = inject(HttpClient);

  title = 'assistant';
  assistantAppTabId: any;
  textArr: Array<String> = []

  mainTitle = "Project"
  lastSelectedSidebarTab: number = 1;
  currentSidebarTab: number = 1;
  currentSideBarStatus = true

  constructor() {
    let me = this;
    afterNextRender(() => {
      if (chrome && chrome.tabs) {
        chrome.tabs.getCurrent((val: any) => {
          console.log("current tab id is:" + val.id);
          this.assistantAppTabId = val.id;
          chrome.storage.local.get(ConfigService.assistantAppTabIdList, (result: any) => {
            const assistantAppTabIdList = result[ConfigService.assistantAppTabIdList];
            if (!assistantAppTabIdList) {
              chrome.storage.local.set({ [ConfigService.assistantAppTabIdList]: [val.id] }, function () {
                // let us know it worked
                console.log("V3 Test: initialized test click counter to 0");
              });
            } else {
              if (assistantAppTabIdList.length >= 0 && !assistantAppTabIdList.includes(val.id)) {
                assistantAppTabIdList.push(val.id);
                chrome.storage.local.set({ [ConfigService.assistantAppTabIdList]: assistantAppTabIdList }, function () {
                  // let us know it worked
                  console.log("V3 Test: initialized test click counter to 0");
                });
              }
            }
          });
        });
      }
      window.onbeforeunload = function () {
        if (me.coreService.privacyErrorSettingWindow) {
          me.coreService.privacyErrorSettingWindow.close();
        }
      }
      me.fileVist()
    });
  }

  ngOnInit(): void {
    let judeType = this.coreService instanceof CoreService;
  }

  async fileVist() {
    if(navigator == undefined || navigator.storage === undefined || await navigator.storage.getDirectory === undefined) {
      console.log("OPFS is not supported in this browser.");
      return;
    }
    const opfsRoot = await navigator.storage.getDirectory();
    // 创建层级结构的文件和文件夹
    const fileHandle = await opfsRoot.getFileHandle("my first file", {
      create: true,
    });
    const directoryHandle = await opfsRoot.getDirectoryHandle("my first folder", {
      create: true,
    });
    const nestedFileHandle = await directoryHandle.getFileHandle(
      "my first nested file",
      { create: true },
    );
    const nestedDirectoryHandle = await directoryHandle.getDirectoryHandle(
      "my first nested folder",
      { create: true },
    );

    // 通过文件名和文件夹名访问已有的文件和文件夹
    const existingFileHandle = await opfsRoot.getFileHandle("my first file");
    const existingDirectoryHandle = await opfsRoot.getDirectoryHandle("my first folder");


    directoryHandle.removeEntry("my first nested file");

    console.log("-----------")
  }

  ngAfterViewInit(): void {
    const rt = this.addTexts()
    var sequence = new Sequence({name: "block1"});

    var str1 = new Utf8String();
    str1.setValue("5");

    var str2 = new Utf8String();
    str1.setValue("a");

    sequence.valueBlock.value.push(str1);
    sequence.valueBlock.value.push(str2);

    var sequence_buffer = sequence.toBER(false); // Encode current sequence to BER (in ArrayBuffer)
    var current_size = sequence_buffer.byteLength;
    var sequence_veiw = new Uint8Array(sequence_buffer);

    var integer_data = new ArrayBuffer(8);
    var integer_view = new Uint8Array(integer_data);
    integer_view[0] = 0x01;
    integer_view[1] = 0x01;
    integer_view[2] = 0x01;
    integer_view[3] = 0x01;
    integer_view[4] = 0x01;
    integer_view[5] = 0x01;
    integer_view[6] = 0x01;
    integer_view[7] = 0x01;

    let stry = new Utf8String()
    stry.setValue("136");

    let num = new Integer({value: 75889});
    let vi = new Uint8Array(num.toBER());
  }

  selectedTabChange(evt: any) {
    if (evt.index == 0) {
      const eventItem: EventItem = new EventItem();
      eventItem.eventType = AppEventType.APP_API_EXPLORER_TAB;
      this.coreService.tabChangeSubject.next(eventItem);
    }
  }

  onCloseTab(evt: any) {

  }

  onAssistantClickTab(evt: any) {
    if (evt.index == 0) {
      const eventItem: EventItem = new EventItem();
      eventItem.eventType = AppEventType.APP_API_EXPLORER_TAB;
      this.coreService.tabChangeSubject.next(eventItem);
    }
  }

  onExplorerClickTab(evt: any) {

  }

  async addTexts() {
    // this.textArr.push("abcdd")
    // this.textArr.push("abcddf")
    // this.textArr.push("abcdde")
    await 1;
  }

  toggleSideBarTab(currentSidebarTab: number) {
    if (currentSidebarTab == this.lastSelectedSidebarTab) {
      if (!this.currentSideBarStatus) {
        this.currentSideBarStatus = true;
      } else {
        this.currentSideBarStatus = false;
      }
    } else {
      this.currentSidebarTab = currentSidebarTab;
      this.currentSideBarStatus = true;
      this.lastSelectedSidebarTab = currentSidebarTab;
      switch (currentSidebarTab) {
        case 1:
          this.mainTitle = "Project"
          break;
        case 2:
          this.mainTitle = "Search"
          break;
        case 3:
          this.mainTitle = "Plugins"
          break;
        case 4:
          this.mainTitle = "API Ecosystem"
          break;
        case 5:
          this.mainTitle = "Settings"
          break;
      }
    }
  }
}
