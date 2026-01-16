import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, OnInit, ViewContainerRef, afterNextRender, inject } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService, EventItem, AppEventType } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './assistant/content/content.component';
import { AstMenuComponent } from './shared/ast-menu/ast-menu.component';
import { SettingsComponent } from './assistant/settings/settings.component';
import { UserCenterComponent } from './assistant/user-center/user-center.component';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstTabGroupComponent, AstTabComponent, ContentComponent]
})
export class AppComponent implements OnInit, AfterViewInit {
  private coreService = inject(CoreService);
  viewContainerRef = inject(ViewContainerRef);
  http = inject(HttpClient);

  title = 'assistant';
  assistantAppTabId: any;
  textArr: Array<String> = []

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  sideOpen = true

  blurSwitch = true;
  isOpen = false;
  menuInitiator: any;

  openedList: Array<any> = [
    {
      id: 'editor',
      title: 'Editor',
      isActive: true,
      isClosable: false,
    }
  ];

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
    let currentIndex = 0;
    let currentActived = evt.isActivated;
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        currentIndex = index;
        this.openedList[currentIndex]["isActive"] = false;
        this.openedList.splice(index, 1);
        break;
      }
    }
    if(currentActived) { //关闭的tab是激活状态，则需要激活其他tab
      if (evt.isFirst) {
        if (this.openedList.length >= 1) {
          this.openedList[0]["isActive"] = true;
          this.activeMainPanel(this.openedList[0]);
        }
      } else if (evt.isLast) {
        if (this.openedList.length >= 1) {
          this.openedList[this.openedList.length - 1]["isActive"] = true;
          this.activeMainPanel(this.openedList[this.openedList.length - 1]);
        }
      } else {
        this.openedList[currentIndex]["isActive"] = true;//close的不是第一个也不是最后一个，则激活后一个， 即中间的某一个
        this.activeMainPanel(this.openedList[currentIndex]);
      }
    }
  }

  onClickTab(evt: any) {
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        this.openedList[index]["isActive"] = true
      } else {
        this.openedList[index]["isActive"] = false
      }
    }

    this.activeMainPanel(evt);
  }

  /**
   * 激活主面板对应的侧边栏tab
   * @param evt 
   */
  private activeMainPanel(evt: any) {
    const id = evt.id;
    switch (id) {
      case 'editor':
        this.currentDisplayViewId = 1;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
      case 'settings':
        this.currentDisplayViewId = 5;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
      case 'user-center':
        this.currentDisplayViewId = 6;
        this.lastSelectedDisplayViewId = this.currentDisplayViewId;
        break;
    }
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

  toggleDisplayViewId(currentDisplayViewId: number) {
    if (currentDisplayViewId == this.lastSelectedDisplayViewId) {
      if (!this.sideOpen) {
        this.sideOpen = true;
      } else {
        this.sideOpen = false;
      }
    } else {
      this.currentDisplayViewId = currentDisplayViewId;
      this.sideOpen = true;
      this.lastSelectedDisplayViewId = currentDisplayViewId;
      switch (currentDisplayViewId) {
        case 1:
          break;
        case 2:
          break;
        case 3:
          break;
        case 4:
          break;
        case 5:
          const settingBar: any = {
            id: 'settings',
            title: 'Settings',
            component: SettingsComponent
          };
          let oldSettingTab = false;
          for (const item of this.openedList) {
            delete item["isActive"];
            if (item.id == settingBar.id) {
              item["isActive"] = true;
              oldSettingTab = true;
            }
          }
          if (!oldSettingTab) {
            settingBar["isActive"] = true
            this.openedList.push(settingBar);
          }
          break;
        case 6:
          const userCenterBar: any = {
            id: 'user-center',
            title: 'User Center',
            component: UserCenterComponent
          };
          let oldTab = false;
          for (const item of this.openedList) {
            delete item["isActive"];
            if (item.id == userCenterBar.id) {
              item["isActive"] = true;
              oldTab = true;
            }
          }
          if (!oldTab) {
            userCenterBar["isActive"] = true
            this.openedList.push(userCenterBar);
          }
          break;
      }
    }
    //如果是API Community，则默认关闭侧边栏
    if (currentDisplayViewId == 4) {
      this.sideOpen = false;
    }
    if(currentDisplayViewId == 5 || currentDisplayViewId == 6) {
      this.closeMenu();
    }
  }


  closeMenu() {
    this.blurSwitch = true;
    this.isOpen = false;
  }

  clickMoreBtn(evt: any) {
    if (!this.isOpen) {
      this.isOpen = !this.isOpen;
      this.menuInitiator = evt.target.getBoundingClientRect();
    }
  }

  blurMoreBtn(evt: any) {
    let me = this;
      if (me.blurSwitch) {
        me.isOpen = false;
      }
  }

  mouseentermenu(evt: any) {
    this.blurSwitch = false;
  }

  mouseleavemenu(evt: any) {
    this.blurSwitch = true;
  }

}
