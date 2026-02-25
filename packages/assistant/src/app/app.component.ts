import { HttpClient } from '@angular/common/http';
import { AfterViewInit, Component, Injector, OnInit, afterNextRender, inject, viewChild } from '@angular/core';
import { Integer, Sequence, Utf8String } from 'asn1js';
import { ConfigService, CoreService } from './core.service';
import { AstTabComponent } from './shared/ast-tab/ast-tab.component';
import { AstTabGroupComponent } from './shared/ast-tab/ast-tab-group/ast-tab-group.component';
import { ContentComponent } from './luxio/content/content.component';
import { AstMenuComponent } from './shared/ast-menu/ast-menu.component';
import { SettingsComponent } from './luxio/settings/settings.component';
import { UserCenterComponent } from './luxio/user-center/user-center.component';
import { file } from 'opfs-tools';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstTabGroupComponent, AstTabComponent, ContentComponent]
})
export class AppComponent implements OnInit, AfterViewInit {
  protected coreService = inject(CoreService);
  contentComp = viewChild(ContentComponent);
  http = inject(HttpClient);

  title = 'luxio';
  luxioAppTabId: any;
  textArr: Array<String> = []

  // current selected file type (extension or nodeType)
  fileType: string = '';

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  sideOpen = true

  blurSwitch = true;
  isOpen = false;
  menuInitiator: DOMRect | undefined;

  openedList: Array<any> = [
    {
      id: 'editor',
      title: 'Editor',
      isClosable: false,
    }
  ];

  constructor(injector: Injector,) {
    let me = this;
    afterNextRender(() => {
      if (chrome && chrome.tabs) {
        chrome.tabs.getCurrent((val: any) => {
          console.log("current tab id is:" + val.id);
          this.luxioAppTabId = val.id;
          chrome.storage.local.get(ConfigService.luxioAppTabIdList, (result: any) => {
            const luxioAppTabIdList = result[ConfigService.luxioAppTabIdList];
            if (!luxioAppTabIdList) {
              chrome.storage.local.set({ [ConfigService.luxioAppTabIdList]: [val.id] }, function () {
                // let us know it worked
                console.log("V3 Test: initialized test click counter to 0");
              });
            } else {
              if (luxioAppTabIdList.length >= 0 && !luxioAppTabIdList.includes(val.id)) {
                luxioAppTabIdList.push(val.id);
                chrome.storage.local.set({ [ConfigService.luxioAppTabIdList]: luxioAppTabIdList }, function () {
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
    console.log("--++++++----")

    const fetchProfile = async () => {
      try {
        const response = await fetch(`/api/auth/profile`, {
          credentials: 'include', // 携带 Cookie
        });
        this.coreService.userData = await response.json();
        this.coreService.isAuthenticated.set(true);
      } catch (err) {
        this.coreService.isAuthenticated.set(false);
        console.error('获取用户信息失败:', err);
        // // 可跳转到登录页
        // window.location.href = '/signin';
      }
    };

    fetchProfile();

    // in extension scene
    if (chrome.storage) {
      function updateWindowRect() {
        // 兼容写法：优先使用 screenX/Y， fallback 到 screenLeft/Top
        const x = window.screenX || window.screenLeft;
        const y = window.screenY || window.screenTop;

        const width = window.outerWidth;
        const height = window.outerHeight;

        chrome.storage.local.set({ windowRect: { x: x, y: y, width: width, height: height } }, function () {
          // let us know it worked
          console.log("V3 Test: updated windowRect to storage: ", x, y, width, height);
        });
      }

      // 初始加载时获取一次
      updateWindowRect();

      // 监听窗口移动事件 (注意：并非所有浏览器都高频触发此事件，且拖动过程中可能不连续更新)
      // window.addEventListener('move', updateWindowRect); //move事件不生效， 注释掉
    }
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
      if(currentDisplayViewId != 4) {
        this.currentDisplayViewId = currentDisplayViewId;
        this.sideOpen = true;
        this.lastSelectedDisplayViewId = currentDisplayViewId;
      }

      switch (currentDisplayViewId) {
        case 1:
          break;
        case 2:
          break;
        case 3:
          break;
        case 4:
          const contentComp = this.contentComp();
          if(contentComp) {
            contentComp.openTab({
              id: 'api-community',
              type: 'api-community',
              label: 'Community'
            });
            contentComp.storeOpenedList();
          }
          break;
        case 5:
          const settingBar: any = {
            id: 'settings',
            title: 'Settings'
          };
          this.openTab(settingBar);
          break;
        case 6:
          const userCenterBar: any = {
            id: 'user-center',
            title: 'User Center'
          };
          this.openTab(userCenterBar);
          break;
      }
    }
    if(currentDisplayViewId == 5 || currentDisplayViewId == 6) {
      this.closeMenu();
    }
  }


  private openTab(targetTab: any) {
    let oldTab = false;
    for (const item of this.openedList) {
      delete item["isActive"];
      if (item.id == targetTab.id) {
        item["isActive"] = true;
        oldTab = true;
      }
    }
    if (!oldTab) {
      targetTab["isActive"] = true;
      this.openedList.push(targetTab);
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

  redirectToLogin(targetUrl?: string) {
    // 默认保存当前页面路径（去掉域名）
    const from = targetUrl || window.location.pathname + window.location.search;

    // 存入 sessionStorage（关闭标签页失效，比 localStorage 更安全）
    sessionStorage.setItem('redirect_after_login', from);

    // 跳转到登录页
    window.location.href = '/signin';
  }

  async handleSignOut() {
    // Clear any stored user data
    localStorage.clear();
    sessionStorage.clear();
    this.closeMenu();
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include' // 确保发送 Cookie
      });

      // 清除前端状态（如 Zustand / Redux / Context）
      // clearAuthState();

      // 跳转到登录页
      // window.location.href = '/signin'; // 或使用 navigate('/signin')
      this.coreService.isAuthenticated.set(false);
    } catch (error) {
      console.error('Logout failed:', error);
      // 即使失败也跳转（Cookie 已由后端清除）
      window.location.href = '/signin';
      this.coreService.isAuthenticated.set(false);
    }
  }

  async cleanUp() {
    await file('/dir/file.txt').remove();
    await file('/dir/file_openedList.txt').remove();
  }
}
