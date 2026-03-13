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
import { ThemeService } from './theme.service';
import { NotificationComponent } from './shared/notification/notification.component';
import { TerminalComponent } from './shared/terminal/terminal.component'; // Import the terminal component

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    host: {
      '(mouseup)': 'dragEnd($event)',
      '(mousemove)': 'whenMouseMove($event)'
    },
    standalone: true,
    imports: [UserCenterComponent, SettingsComponent, AstMenuComponent, AstTabGroupComponent, AstTabComponent, ContentComponent, NotificationComponent, TerminalComponent], // Add TerminalComponent to imports
})
export class AppComponent implements OnInit, AfterViewInit {
  protected coreService = inject(CoreService);
  protected themeService = inject(ThemeService);
  contentComp = viewChild(ContentComponent);
  http = inject(HttpClient);

  title = 'luxio';
  luxioAppTabId: any;
  textArr: Array<String> = []

  // current selected file type (extension or nodeType)
  fileType: string = '';
  filePermission: string = '';

  lastSelectedDisplayViewId: number = 1;
  currentDisplayViewId: number = 1;
  terminalShow = false;
  keepTerminalInstance = {
    value: false,
    dragHeight: 0.75,
  }
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
      // me.fileVist()
    });
  }

  ngOnInit(): void {
    let judeType = this.coreService instanceof CoreService;
    console.log("--++++++----")

    const fetchProfile = async () => {
      // Skip API call during SSR to avoid SSL certificate issues
      // The profile will be fetched when the app runs on the browser
      if (typeof window === 'undefined') {
        // Running on the server - skip the API call
        console.log("Skipping profile fetch during SSR");
        return;
      }

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
    if (typeof chrome !== 'undefined' && chrome.storage) {
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

    if (typeof document !== 'undefined') {
      // 初始化主题
      if (this.themeService.getCurrentTheme() === 'dark') {
        document.body.classList.add('vscode-dark-theme');
      } else {
        document.body.classList.remove('vscode-dark-theme');
      }
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

  // 显示上传进度详情
  showUploadProgressDetails(): void {
    // 准备要显示的进度详情文本
    let progressDetails = "";
    if (this.coreService.uploadTasks().length > 0) {
      progressDetails = this.coreService.uploadTasks().map(task => 
        `${task.fileName}: ${Math.floor(task.progress() * 100)}% (${task.status})`
      ).join('\n');
    } else {
      progressDetails = "No active uploads";
    }

    // 使用通知组件显示进度详情
    this.coreService.showNotification(this.coreService.progressDetails(), 'info');
  }

  // 切换主题的方法
  toggleTheme() {
    this.themeService.toggleTheme();
    if (this.themeService.getCurrentTheme() === 'dark') {
      document.body.classList.add('vscode-dark-theme');
    } else {
      document.body.classList.remove('vscode-dark-theme');
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
      case 'terminal': // Handle terminal tab activation
        this.currentDisplayViewId = 7; // Assign a unique ID for terminal
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

  // Method to open a new terminal tab
  toggleTerminal(): void {
    if(!this.keepTerminalInstance.value) {
      this.keepTerminalInstance.value = true; // Ensure the terminal instance is created and kept alive
    }
    if(this.terminalShow) {
      this.terminalShow = false;
      this.dragHeight = 1; // Reset drag height when closing terminal
    } else {
      this.terminalShow = true;
      this.dragHeight = 0.75;
      if(this.keepTerminalInstance.value) {
        this.dragHeight = this.keepTerminalInstance.dragHeight;
      }
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

  // 添加上传任务的方法（供外部调用）
  addUploadTask(fileName: string): string {
    return this.coreService.addUploadTask(fileName);
  }

  // 更新上传任务进度的方法（供外部调用）
  updateUploadProgress(taskId: string, progress: number): void {
    this.coreService.updateUploadProgress(taskId, progress);
  }

  // 标记上传任务为失败
  failUploadTask(taskId: string): void {
    this.coreService.failUploadTask(taskId);
  }

  // 移除上传任务
  removeUploadTask(taskId: string): void {
    this.coreService.removeUploadTask(taskId);
  }

  async cleanUp() {
    await file('/dir/file.txt').remove();
    await file('/dir/openedList.txt').remove();
  }

  dragHeight: number = 1;
  active = false;

  // 用于存储当前拖动元素的父元素，以便在拖动结束时恢复样式
  maskLayerElement: any;

  initialY: number = 0;
  topSectionHeight: number = 0;
  bottomSectionHeight: number = 0;

  dragStart(evt: any, currentCursorType: string = 'ns') {
    this.maskLayerElement = evt.target.parentElement; // 获取父元素作为遮罩层
    evt.target.parentElement.style.zIndex = 90; // 提升遮罩层的 z-index，使其覆盖其他元素
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize'; // 更改光标样式

    const currentTarget = evt.currentTarget;
    const parentParent = currentTarget.parentElement.parentElement.childNodes;
    this.topSectionHeight = parentParent[1].clientHeight
    this.bottomSectionHeight = parentParent[2].clientHeight
    this.initialY = evt.clientY;
    evt.preventDefault()
    this.active = true;
  }

  dragEnd(evt: any) {
    // initialX = currentX;  
    // initialY = currentY;  
    this.active = false;
    if (this.maskLayerElement) {
      this.maskLayerElement.style.zIndex = "";
    }
    document.body.style.cursor = 'default'; // 恢复默认光标
  }

  whenMouseMove(evt: any) {
    if (this.active) {
      evt.preventDefault()
      const yOffset = evt.clientY - this.initialY;
      this.dragHeight = (this.topSectionHeight + yOffset) / (this.topSectionHeight + this.bottomSectionHeight)
      this.keepTerminalInstance.dragHeight = this.dragHeight; // 保存当前拖动高度到 keepTerminalInstance，以便在重新打开终端时恢复
      return;
    }
  }

}