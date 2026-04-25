import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { file, write } from 'opfs-tools';
import { ServiceRouteInfo, AstTreeNode, UserInfo } from './shared/model';
import { NotificationService } from './shared/notification/notification.service';
import JSZip from 'jszip';

// 定义上传任务接口
interface UploadTask {
  id: string;
  fileName: string;
  progress: WritableSignal<number>; // 0 to 1
  status: 'pending' | 'uploading' | 'completed' | 'failed';
}

@Injectable({
  providedIn: 'root'
})
export class CoreService {
  private http = inject(HttpClient);
  private notificationService = inject(NotificationService);

  // public selectedServerAndServiceInfo: ServerAndServiceInfo = new ServerAndServiceInfo();

  // public dialogSubject = new Subject();

  // public specDef: any = {};

  // apiArr: Array<any> = [];

  public chooseSpecDef: any = {};

  privacyErrorSettingWindow: any;

  ui: any;

  // explorerApiLoading = false;
  choosingApiLoading = false;

  /**
   * key:   previous url  .eg: 127.0.0.1:12000/api
   * value: access token
   */
  toStoreAccessTokenMap = new Map<string, string>();

  // pageSize = 5;
  // pageNumber = 1;
  // totalCount = 0;
  // totalPageNumber = 1;
  // displayPathsArray: Array<any> = [];

  serverList: Array<any> = [];
  currentServerIndex = 0;
  currentServer: any;
  isAuthenticated = signal(false);
  userData: UserInfo | undefined;

  // Upload tasks array to track ongoing uploads
  uploadTasks = signal<UploadTask[]>([]);
  totalProgress = computed(() => this.getOverallProgress());
  progressPercentage = computed(() => Math.floor(this.getOverallProgress() * 100));
  progressDetails = computed(() => {
    return this.getUploadProgressDetails();
  });

  // Saving state for save operations
  saving = signal<boolean>(false);

  // Forking state for fork operations
  forking = signal<boolean>(false);

  // 添加一个方法来显示通知
  showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    this.notificationService.showNotification(message, type);
  }

  // 添加上传任务的方法
  addUploadTask(fileName: string): string {
    const taskId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTask: UploadTask = {
      id: taskId,
      fileName: fileName,
      progress: signal<number>(0),
      status: 'pending'
    };
    this.uploadTasks.update(tasks => [...tasks, newTask]);
    return taskId;
  }

  // 更新上传任务进度的方法
  updateUploadProgress(taskId: string, progress: number): void {
    const task = this.uploadTasks().find(t => t.id === taskId);
    if (task) {
      task.progress.set(Math.min(1, Math.max(0, progress))); // 限制在0-1之间
      if (progress < 1) {
        task.status = 'uploading';
      } else {
        task.status = 'completed';
      }
    }
  }

  // 标记上传任务为失败
  failUploadTask(taskId: string): void {
    const task = this.uploadTasks().find(t => t.id === taskId);
    if (task) {
      task.status = 'failed';
    }
  }

  // 移除上传任务
  removeUploadTask(taskId: string): void {
    this.uploadTasks.update(tasks => tasks.filter(t => t.id !== taskId));
  }

  // 获取总体上传进度
  getOverallProgress(): number {
    if (this.uploadTasks().length === 0) return 0;

    const totalProgress = this.uploadTasks().reduce((sum, task) => sum + task.progress(), 0);
    return totalProgress / this.uploadTasks().length;
  }

  // 显示上传进度详情
  getUploadProgressDetails(): string {
    // 准备要显示的进度详情文本
    let progressDetails = "";
    if (this.uploadTasks().length > 0) {
      progressDetails = this.uploadTasks().map(task =>
        `${task.fileName}: ${Math.floor(task.progress() * 100)}% (${task.status})`
      ).join('\n');
    } else {
      progressDetails = "No active uploads";
    }

    return progressDetails;
  }

  initApiUI(spec: any, elementId: string) {
    const selectedServerAndServiceInfo = {
      server: this.currentServer,
      serviceRoute: this.currentServer.serviceRoute
    };
    this.initApiUIX(spec, this.currentServer, '#' + elementId);
  }

  clearApiUI(elementId: string) {
    this.clearApiUIX('#' + elementId);
  }

  initApiUIX(spec: any, server: any, swaggerUiId: string) {
    if (spec && spec.paths) {
      if (server.value.startsWith("http://")) {
        spec["schemes"] = ["http"];
      } else if (server.value.startsWith("https://")) {
        spec["schemes"] = ["https"];
      }

      spec["host"] = this.extractIp(server.value) + ":" + server.serviceRoute.publishPort;
      spec["basePath"] = server.serviceRoute.publishUrl;

      const paths = spec.paths;
      let displayPaths: any = {};
      let count = 0;
      for (const pathKey in paths) {
        if (Object.prototype.hasOwnProperty.call(paths, pathKey)) {
          displayPaths[pathKey] = paths[pathKey];
          count++;
        }
      }
      this.ui = SwaggerUIBundle({
        spec: spec,
        dom_id: swaggerUiId,
        defaultModelsExpandDepth: -1,
        onComplete: (evt: any) => {

        }
      });
    } else {
      this.clearApiUIX(swaggerUiId);
    }
  }

  clearApiUIX(swaggerUiId: string) {
    const specObj = {
      swagger: "2.0"
    }
    this.ui = SwaggerUIBundle({
      spec: specObj,
      dom_id: swaggerUiId,
      requestInterceptor: (data: any) => {

      },
      onComplete: (evt: any) => {

      }
    });
  }

  findPageNumberByPathKey(server: any, pathKey: string) {
    const currentApiInfo = server.apiArr.filter((apiInfo: any) => apiInfo.id == server.currentServiceId)[0];
    for (let index = 0; index < currentApiInfo.displayPathsArray.length; index++) {
      const element = currentApiInfo.displayPathsArray[index];
      if (pathKey in element) {
        return index + 1;
      }
    }
    return 1;
  }

  goToPage(server: any, targetPageNumber: any) {
    const currentApiInfo = server.apiArr.filter((apiInfo: any) => apiInfo.id == server.currentServiceId)[0];
    if (targetPageNumber < 0 || targetPageNumber > currentApiInfo.totalPageNumber) {
      return;
    }

    if (currentApiInfo.pageNumber != targetPageNumber) {
      currentApiInfo.pageNumber = targetPageNumber;
      currentApiInfo.specDef.paths = currentApiInfo.displayPathsArray[targetPageNumber - 1];
      this.clearApiUI(currentApiInfo.elementId);
      this.initApiUI(currentApiInfo.specDef, currentApiInfo.elementId);
    }
  }

  async initService() {
    const serviceList: Array<ServiceRouteInfo> = await new Promise((resolve) => {
      this.http.get<Array<ServiceRouteInfo>>(ConfigService.microserviceListUrl).subscribe((val: Array<ServiceRouteInfo>) => {
        const filterVal = val.filter((x) => {
          return (x.publishProtocol == "https" && (x.routeType == "api" || x.routeType == "custom"));
          //  && (x.publishPort == 28001 || x.publishPort == 8980 || x.publishPort == 18010));
        }).sort(function (a, b) {
          if (a.serviceName && b.serviceName) {
            const left = a.serviceName.replace(/-/g, "");
            const right = b.serviceName.replace(/-/g, "");
            const minLength = left.length > right.length ? right.length : left.length;

            for (let index = 0; index < minLength; index++) {
              const left0 = left.charCodeAt(index);
              const right0 = right.charCodeAt(index);
              const diff = left0 - right0;

              if (diff != 0) {
                return diff;
              }
            }
            return left.length > right.length ? 1 : -1;
          } else if (!a.serviceName) {
            return -1;
          } else {
            return -1;
          }
        });
        resolve(filterVal);
      });
    });
    return serviceList;
  }

  getData(url: string) {
    return this.http.get<any>(url);
  }

  postData(url: string, data: any) {
    return this.http.post(url, data);
  }

  /**
 * 通用的文件下载方法
 * @param url - 文件的 URL
 */
  downloadFile(url: string) {
    return this.http.get(url, {
      responseType: 'blob' // 关键：将响应类型设置为 blob
    })
  }

  async setServerToStorage(data: any) {
    const basePath = data.scheme + "://" + data.ip + ":" + data.port;

    const serverListString = await file('/dir/serverList.txt').text();
    let serverList = (serverListString??"") != "" ? JSON.parse(serverListString): [];
    if(serverList && serverList.length > 0) {
        if (!serverList.includes(basePath)) {
           serverList.push(basePath);
           await write('/dir/serverList.txt', JSON.stringify(serverList));
        }
    } else {
      await write('/dir/serverList.txt', JSON.stringify([basePath]));
    }
  }

  async getServersFromStorage(abandonHttp: boolean) {
    const serverListString = await file('/dir/serverList.txt').text();
    let serverList = (serverListString??"") != "" ? JSON.parse(serverListString): [];
    return this.convertServers(serverList, abandonHttp);
  }

  async deleteServerFromStorage(server: string) {
    const serverListString = await file('/dir/serverList.txt').text();
    let serverList = (serverListString??"") != "" ? JSON.parse(serverListString): [];
    if (serverList && serverList.length > 0) {
      let updateList: Array<string> = [];
      for (const li of serverList) {
        if (li != server) {
          updateList.push(li);
        }
      }
      await write('/dir/serverList.txt', JSON.stringify(updateList));
    } else {
    }
  }

  convertServers(serverList: Array<string>, abandonHttp: boolean) {
    if (serverList && serverList.length > 0) {
      let servers: Array<any> = [];
      for (let index = 0; index < serverList.length; index++) {
        const element = serverList[index];
        if (element.startsWith("http://") && abandonHttp) {
          continue;
        }
        let text: string = element.replace(/http:\/\/|https:\/\//, "");
        const pos = text.lastIndexOf(":");
        if (pos > 0) {
          text = text.substring(0, pos);
        }
        servers.push({
          value: element,
          text: text,
          data: {
            userName: '',
            passwd: ''
          },
          apiArr: []
        });
      }
      return servers;
    } else {
      return [];
    }
  }

  async getMicroserviceDataStatusFlagFromStorage() {
    const microserviceDataStatusFlag = await file('/dir/microserviceDataStatusFlag.txt').text();
    return microserviceDataStatusFlag;
  }

  async setMicroserviceDataToStorage(service: ServiceRouteInfo) {
    const microserviceDataListString = await file('/dir/microserviceDataList.txt').text();
    let microserviceDataList = (microserviceDataListString??"") != "" ? JSON.parse(microserviceDataListString): [];
    if(microserviceDataList && microserviceDataList.length > 0) {
        if (!microserviceDataList.some((val: any) => service.serviceName == val.serviceName)) {
           microserviceDataList.push(service);
           await write('/dir/microserviceDataList.txt', JSON.stringify(microserviceDataList));
        }
    } else {
      await write('/dir/microserviceDataList.txt', JSON.stringify([service]));
    }
    await write('/dir/microserviceDataStatusFlag.txt', MicroserviceDataStatus.modified);
    return microserviceDataList;
  }

  public isContain(microserviceData: Array<ServiceRouteInfo>, service: ServiceRouteInfo) {
    let flag = false;
    for (const serviceData of microserviceData) {
      if (serviceData.serviceName == service.serviceName) {
        flag = true;
      }
    }
    return flag;
  }

  async resetMicroserviceDataToStorage(services: Array<ServiceRouteInfo>) {
    await write('/dir/microserviceDataList.txt', JSON.stringify(services));
    await write('/dir/microserviceDataStatusFlag.txt', MicroserviceDataStatus.raw);
  }

  async getMicroserviceDataFromStorage() {
    const microserviceDataListString = await file('/dir/microserviceDataList.txt').text();
    let microserviceDataList = (microserviceDataListString??"") != "" ? JSON.parse(microserviceDataListString): [];
    return microserviceDataList;
  }

  async deleteServiceFromStorage(serviceRoute: ServiceRouteInfo) {
    const microserviceDataListString = await file('/dir/microserviceDataList.txt').text();
    let microserviceDataList = (microserviceDataListString??"") != "" ? JSON.parse(microserviceDataListString): [];
    if (microserviceDataList && microserviceDataList.length > 0) {
      let updateList: Array<ServiceRouteInfo> = [];
      for (const li of microserviceDataList) {
        if (li.serviceName != serviceRoute.serviceName) {
          updateList.push(li);
        }
      }
      await write('/dir/microserviceDataList.txt', JSON.stringify(updateList));
      await write('/dir/microserviceDataStatusFlag.txt', MicroserviceDataStatus.modified);
    } else {
    }
  }

  async getServiceData() {
    const microserviceDataStatusFlag = await this.getMicroserviceDataStatusFlagFromStorage();
    if (!microserviceDataStatusFlag || microserviceDataStatusFlag == "" || microserviceDataStatusFlag == MicroserviceDataStatus.raw) {
      const serviceList = await this.initService();
      return serviceList;
    } else {
      const serviceList = await this.getMicroserviceDataFromStorage();
      return serviceList;
    }
  }

  // IndexedDB helpers: put/get that correctly await transaction and request
  async idbPut(key: string, value: any) {
    const db = await this.openDBInternal();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      console.debug('idbPut: storing key=', key, 'value=', value && value.name ? value.name : value);
      const req = store.put(value, key);
      req.onsuccess = () => { };
      req.onerror = () => { };
      tx.oncomplete = () => resolve("done");
      tx.onabort = tx.onerror = () => reject(tx.error || req.error);
    });
  }

  async idbGet(key: string) {
    const db: IDBDatabase = await this.openDBInternal();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      console.debug('idbGet: fetching key=', key);
      const req = store.get(key);
      req.onsuccess = () => {
        console.debug('idbGet: got key=', key, 'result=', req.result && req.result.name ? req.result.name : req.result);
        resolve(req.result);
      };
      req.onerror = () => {
        console.error('idbGet: error getting key=', key, req.error);
        reject(req.error);
      };
    });
  }

  async idbDelete(key: string) {
    const db = await this.openDBInternal();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      const store = tx.objectStore('handles');
      console.debug('idbDelete: deleting key=', key);
      const req = store.delete(key);
      req.onsuccess = () => { 
        console.debug('idbDelete: successfully deleted key=', key);
        resolve("done"); 
      };
      req.onerror = () => { 
        console.error('idbDelete: error deleting key=', key, req.error);
        reject(req.error); 
      };
      tx.oncomplete = () => resolve("done");
      tx.onabort = tx.onerror = () => reject(tx.error || req.error);
    });
  }

  private openDBInternal(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request: IDBOpenDBRequest = indexedDB.open('fs-editor', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  public isBinaryName(name: string): boolean {
    return /\.(exe|dll|bin|dat|jpg|jpeg|png|gif|zip|7z|rar|tar|gz|iso|keystore|p12|jks|jar)$/i.test(name);
  }


  splitSpec(apiInfo: any) {
    if (!apiInfo || !apiInfo.specDef || !apiInfo.specDef.paths) {
      return;
    }

    if (apiInfo.specDef.tags && apiInfo.specDef.tags.length > 0) {
      apiInfo.specDef.tags.splice(0, apiInfo.specDef.tags.length);
    }

    const paths = apiInfo.specDef.paths;
    apiInfo.pageNumber = 1;

    apiInfo.displayPathsArray = [];
    let count = 0;
    let startIndex = 0;
    let pageSize = 5;
    let expectEndIndex = pageSize;

    let displayPaths: any = {};
    for (const pathKey in paths) {
      if (Object.prototype.hasOwnProperty.call(paths, pathKey)) {
        if (count >= startIndex) {
          displayPaths[pathKey] = paths[pathKey];
        }

        count++;

        if (count == expectEndIndex) {
          apiInfo.displayPathsArray.push(displayPaths);
          startIndex = count;
          if (count + pageSize > apiInfo.totalCount) {
            expectEndIndex = apiInfo.totalCount;
          } else {
            expectEndIndex = count + pageSize;
          }
          displayPaths = {};
        }
      }
    }
  }

  async doAuthorize(authorizeUrl: string, data: { userName: string; passwd: string; }, callback: (result: number) => void) {
    let me = this;
    if (!chrome.declarativeNetRequest) {
      return;
    }
    if (!chrome.storage) {
      return;
    }
    const server = this.extractBasePath(authorizeUrl);
    if (server == null || server == undefined || server == '') {
      return;
    }

    let doHasMatchRule = await this.checkIfHasMatchAccessToken(server);
    if (!doHasMatchRule) {
      const userInfo = {
        username: data.userName,
        password: data.passwd,
        grant_type: "PASSWORD"
      }

      try {
        const res: any = await new Promise((resolve, reject) => {
          me.http.post(authorizeUrl, userInfo).subscribe(async (val: any) => {
            resolve(val);
          }, (reason: any) => {
            reject(reason);
          });
        });
        if (!res['access_token'] && !res['accessToken']) {
          callback(0);
          return;
        }
        me.toStoreAccessTokenMap.set(me.getPreviousUrl(server, ConfigService.modifyHeaderUrlFlag), res['access_token'] || res['accessToken']);
        let randId = me.getRandId();
        let requestHeaders: Array<chrome.declarativeNetRequest.ModifyHeaderInfo> = [
          {
            header: ConfigService.zAccesstokenHeaderName,
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            value: res['access_token'] || res['accessToken']
          },
          {
            header: ConfigService.cookieHeaderName,
            operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE
          }
        ];
        const tab: chrome.tabs.Tab | undefined = await chrome.tabs.getCurrent();
        if (tab && tab.url) {
          const url = tab.url.replace("chrome-extension://", "").replace(/\/.*/, "");
          const updateRuleOptions: any = me.constructUpdateRuleOptions(randId, [url], requestHeaders, '.*' + me.getPreviousUrl(server, ConfigService.modifyHeaderUrlFlag) + '.*');

          const updateResult = await chrome.declarativeNetRequest.updateDynamicRules(updateRuleOptions);
          console.log('authorized', updateResult);
          callback(1);
        }
      } catch (error: any) {
        if (error.status == 0) {
          if (authorizeUrl.startsWith("https://")) {
            me.handlePrivacyError(authorizeUrl);
          }
        }
      }
    }
  }

  public async checkIfHasMatchAccessToken(server: string) {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    let doHasMatchRule = false;
    if (rules && rules.length > 0) {
      for (let index = 0; index < rules.length; index++) {
        const rule = rules[index];
        if (rule.condition && rule.condition.regexFilter) {
          if (server && this.getPreviousUrl(server, ConfigService.modifyHeaderUrlFlag).match(rule.condition.regexFilter)) {
            const requestHeaders: any = rule.action.requestHeaders;
            const zAccesstoken = requestHeaders.filter((val: any) => val.header == ConfigService.zAccesstokenHeaderName);
            if (zAccesstoken.length > 0) {
              // if (zAccesstoken[0].value == me.toStoreAccessTokenMap.get(me.getPreviousUrl(server, ConfigService.modifyHeaderUrlFlag))) {
              // }
              doHasMatchRule = true;
              break;
            }
          }
        }
      }
    }
    return doHasMatchRule;
  }

  async clearAuthorize(server: string, callback: (result: number) => void) {
    let me = this;
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules && rules.length > 0) {
      for (let index = 0; index < rules.length; index++) {
        const rule = rules[index];
        if (rule.condition && rule.condition.regexFilter) {
          if (server && me.getPreviousUrl(server, ConfigService.modifyHeaderUrlFlag).match(rule.condition.regexFilter)) {
            const requestHeaders: any = rule.action.requestHeaders;
            const zAccesstoken = requestHeaders.filter((val: any) => val.header == ConfigService.zAccesstokenHeaderName);
            if (zAccesstoken.length > 0) {
              const removeRuleOptions: any = {
                removeRuleIds: [
                  rule.id
                ]
              };

              const updateResult = await chrome.declarativeNetRequest.updateDynamicRules(removeRuleOptions);
              callback(1);
            }
          }
        }
      }
    }
  }

  async clearAllAuthorize(callback?: (result: number) => void) {
    let me = this;
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules && rules.length > 0) {
      let removeRuleIds = [];
      for (let index = 0; index < rules.length; index++) {
        const rule = rules[index];
        const requestHeaders: any = rule.action.requestHeaders;
        const zAccesstoken = requestHeaders.filter((val: any) => val.header == ConfigService.zAccesstokenHeaderName);
        if (zAccesstoken.length > 0) {
          removeRuleIds.push(rule.id);

        }
      }

      if (removeRuleIds.length > 0) {
        const removeRuleOptions: any = {
          removeRuleIds: removeRuleIds
        };

        const updateResult = await chrome.declarativeNetRequest.updateDynamicRules(removeRuleOptions);
        if (callback) {
          callback(1);
        }
      }
    }
  }

  private constructUpdateRuleOptions(randId: number, initiatorDomains: Array<any>, requestHeaders: Array<chrome.declarativeNetRequest.ModifyHeaderInfo>, regexFilter: string): any {
    return {
      addRules: [
        {
          id: randId,
          priority: 2,
          action: {
            type: 'modifyHeaders',
            requestHeaders: requestHeaders,
          },
          condition: {
            initiatorDomains: initiatorDomains,
            regexFilter: regexFilter,
            resourceTypes: [
              'main_frame',
              'sub_frame',
              "xmlhttprequest"
            ],
          },
        }
      ]
    };
  }

  getRandId() {
    const len = 6;
    const array: Array<any> = "0123456789".split("").sort(_ => Math.random() - .5).slice(0, len);
    let randId = 0;
    for (let index = 0; index < len; index++) {
      randId = randId + array[index] * Math.pow(10, len - index - 1);
    }
    return randId;
  }

  public handlePrivacyError(url: string) {
    // this.dialogSubject.next({
    //   action: "open",
    //   id: ConfigService.dialogHttpsInterruptId,
    //   data: {
    //     // targetUrl: this.getSpecUrl(),
    //     targetUrl: url,
    //   }
    // });
  }

  extractBasePath(url: string) {
    let scheme = '';
    let rs = '';
    if (url.startsWith("http://")) {
      scheme = "http://";
      rs = url.replace("http://", "");
    } else if (url.startsWith("https://")) {
      scheme = "https://";
      rs = url.replace("https://", "");
    } else if (url.startsWith("chrome-extension://")) {
      scheme = "chrome-extension://";
      rs = url.replace("chrome-extension://", "");
    }
    const firstSlashIndex = rs.indexOf("/");
    const ipAndPortResult = scheme + rs.substring(0, firstSlashIndex);
    return ipAndPortResult;
  }

  extractIp(url: string) {
    let rs = '';
    if (url.startsWith("http://")) {
      rs = url.replace("http://", "");
    } else if (url.startsWith("https://")) {
      rs = url.replace("https://", "");
    } else if (url.startsWith("chrome-extension://")) {
      rs = url.replace("chrome-extension://", "");
    }
    const index = rs.lastIndexOf(":")
    if (index > -1) {
      return rs.substring(0, index)
    } else {
      return rs;
    }
  }


  getPreviousUrl(server: string | undefined, modifyHeaderUrlFlag: string) {
    return server + modifyHeaderUrlFlag;
  }

  public getAuthorizeUrl(server: any) {
    return server.value + ConfigService.authorizedUrl;
  }

  public getSpecUrl(server: any) {
    return this.getSpecUrlByServerAndServiceInfo(server);
  }

  public getSpecUrlByServerAndServiceInfo(server: any) {
    if (server && server.serviceRoute) {
      const basePath = this.getBasePath(server);
      if (server.serviceRoute.specUrl) {
        return basePath + server.serviceRoute.specUrl;
      } else {
        return basePath + ConfigService.prefix + server.serviceRoute.routeName + '/' + ConfigService.apiVersion;
      }
    } else {
      return '';
    }
  }


  public getBasePath(server: any) {
    if (server && server.serviceRoute) {
      const scheme = server.serviceRoute.publishProtocol;
      const publishPort = server.serviceRoute.publishPort;
      const serverIp = this.extractIp(server.value);
      const basePath = scheme + "://" + serverIp + ":" + publishPort;
      return basePath;
    } else {
      return '';
    }
  }

  public reset(data: Array<any>, deepIn?: boolean) {
    for (let index = 0; index < data.length; index++) {
      const dataItem = data[index];
      delete dataItem['isActive'];
      delete dataItem['isExpanded'];
      delete dataItem['saved'];
      if (deepIn == null || deepIn) { //递归重置子节点
        if (dataItem.children && dataItem.children.length) {
          this.reset(dataItem.children)
        }
      }
    }
  }

  public parseOpenApiSpec(rawSpecDef: any, currentServer?: any, serviceName?: string) {
    let apiInfos: any = [];
    const paths = rawSpecDef.paths;
    for (const pathKey in paths) {
      if (Object.prototype.hasOwnProperty.call(paths, pathKey)) {
        const methodInfos = paths[pathKey];
        if (methodInfos) {
          for (const methodInfoKey in methodInfos) {
            if (Object.prototype.hasOwnProperty.call(methodInfos, methodInfoKey)) {
              let url = pathKey
              if(currentServer) {
                url = currentServer.value + "/api/" + serviceName + "/v1" + pathKey;
              } else if(rawSpecDef.servers && rawSpecDef.servers.length > 0) {
                url = rawSpecDef.servers[0].url +  pathKey;
              }

              const apiInfo: AstTreeNode = {
                id: this.uuid(),
                folderInfo: {
                  servers: rawSpecDef.servers ? rawSpecDef.servers : [],
                },
                serviceName: serviceName ? serviceName : '',
                method: methodInfoKey,
                symbol: methodInfoKey.toUpperCase(),
                path: pathKey,
                url: url,
                label: pathKey,
                rawApiInfo: methodInfos[methodInfoKey],
                server: currentServer,
                symbolColor: CoreService.getSymbolColor(methodInfoKey.toUpperCase()),
                nodeType: 'api',
                response: {},
                children: [],
                customQueryparameters: [],
                customHeaderparameters: [],
                auth: {},
                consumes: []
              }
              if (apiInfo.rawApiInfo.parameters) {
                const parameterBody = apiInfo.rawApiInfo.parameters.filter((val: any) => val.in == 'body');
                if (parameterBody && parameterBody.length > 0) {
                  apiInfo["requestBody"] = {
                    content: {},
                  }
                  apiInfo['consumes'] = apiInfo.rawApiInfo['consumes']
                  const currentConsume = apiInfo.rawApiInfo['consumes'].length > 0 ? apiInfo.rawApiInfo['consumes'][0] : "application/json" //TODO 简化处理暂时取第一个
                  apiInfo['currentConsume'] = currentConsume
                  let requestBody: any = this.parseParaModel(parameterBody[0], rawSpecDef['definitions']); // support openapi 2.0
                  apiInfo["requestBody"]["content"][currentConsume] = JSON.stringify(requestBody, null, 4);
                  apiInfo["parameterHasBody"] = true;//标记该接口有body参数，仅适用于openapi 2.0
                } else {
                  for(const parameter of apiInfo.rawApiInfo.parameters) {
                    if(parameter.in=='query' || parameter.in=='header' || parameter.in=='path' || parameter.in=='formData') {
                      if(parameter.type=='integer'||(parameter.schema!=null&&parameter.schema.type=='integer')
                        || parameter.type=='number'||(parameter.schema!=null&&parameter.schema.type=='number')) {
                        parameter.uiType = 'number';
                      }
                      if(parameter.type=='string'||(parameter.schema!=null&&parameter.schema.type=='string')) {
                        parameter.uiType = 'text';
                      }
                      if(parameter.type=='boolean'||(parameter.schema!=null&&parameter.schema.type=='boolean')) {
                        parameter.uiType = 'text';// TODO 未来可以改成checkbox
                      }
                    }
                  }
                  const parameterFormData = apiInfo.rawApiInfo.parameters.filter((val: any) => val.in == 'formData');
                  if (parameterFormData && parameterFormData.length > 0) {
                    apiInfo["parameterHasFormDataVer2"] = true;//标记该接口有formData参数，仅适用于openapi 2.0  body参数和formData参数互斥
                  }
                  // support openapi 3.0 enum parameter parsing
                  for (const param of apiInfo.rawApiInfo.parameters) {
                    const paramSchema = param.schema;
                    if (paramSchema && paramSchema['$ref']) {
                      const bodyName = paramSchema['$ref'].substring(paramSchema['$ref'].lastIndexOf('/') + 1);
                      const def = rawSpecDef["components"]["schemas"][bodyName];
                      param.type = this.parseElementType(def);
                      param.uiType = (param.type == 'integer' || param.type == 'number') ? 'number' : 'text';
                      param.value = this.parseElement(def);
                    }
                  }
                }
              }

              //support openapi 3.0
              if (apiInfo.rawApiInfo.requestBody) {
                const content = apiInfo.rawApiInfo.requestBody.content;
                apiInfo["requestBody"] = {
                  content: {}
                }

                for (const key in content) {
                  if (Object.prototype.hasOwnProperty.call(content, key)) {
                    const element = content[key];
                    apiInfo['consumes']?.push(key);
                    if (element) {
                      if (element.schema == undefined) {
                        console.log("pathKey is:", pathKey);
                        console.log("key is:", key);
                        console.log("content is:", content);
                        console.log("Unsupported requestBody schema format:", element);
                        continue;
                      }
                      if (key != 'application/x-www-form-urlencoded' && key != 'multipart/form-data') {//TODO 支持更多的content-type
                        let requestBody: any = this.parseParaModel(element, rawSpecDef["components"]["schemas"]);
                        apiInfo["requestBody"]["content"][key] = JSON.stringify(requestBody, null, 4)
                      } else {
                        let requestFormDataBody: any = this.parseFormDataParaModel(element, rawSpecDef["components"]["schemas"]);
                        apiInfo["requestBody"]["content"][key] = requestFormDataBody;
                      }
                      apiInfo["parameterHasBody"] = true;//标记该接口有body参数，仅适用于openapi 3.0
                    }
                  }
                }
                if (apiInfo.consumes) {
                  if (apiInfo.consumes.length > 0) {
                    apiInfo['currentConsume'] = apiInfo['consumes'][0]
                  }
                }
              }

              apiInfos.push(apiInfo);
            }
          }
        }
      }
    }

    return apiInfos;
  }

  public static getSymbolColor(method: string): string {
    if (method.toLowerCase() == 'get') {
      return 'green'
    } else if (method.toLowerCase() == 'post') {
      return 'orange'
    } else if (method.toLowerCase() == 'put') {
      return 'lightskyblue'
    } else if (method.toLowerCase() == 'delete') {
      return 'red'
    }
    return "black"
  }

  public parseParaModel(parameterObj: any, dataDef: any) {
    let bodyModel;
    if (parameterObj.schema['$ref']) { // 对象类型
      bodyModel = this.parseModel(parameterObj.schema['$ref'], dataDef);
    } else if (parameterObj.schema['type'] == 'array') { // 数组类型
      const itemObj = parameterObj.schema['items'];
      if (itemObj['$ref']) {
        bodyModel = this.parseModel(itemObj['$ref'], dataDef);
      } else if (itemObj['type']) {
        bodyModel = this.parseElement(itemObj);
      }
      bodyModel = [bodyModel];
    }
    return bodyModel;
  }

  public parseModel(modelDef: any, apiDef: any) {
    const model: any = {};
    const bodyName = modelDef.substring(modelDef.lastIndexOf('/') + 1);
    const def = apiDef[bodyName];
    const props = def['properties'];
    if (props) {
      for (const key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          const element = props[key];
          if (element.hasOwnProperty('items') && element['type'] == 'array') {
            if (element["items"]['$ref']) {
              model[key] = [this.parseModel(element["items"]['$ref'], apiDef)]
            } else if (element["items"]['type']) {
              model[key] = [this.parseElement(element["items"])];
            }
          } else if (element.hasOwnProperty('$ref')) {
            model[key] = this.parseModel(element['$ref'], apiDef)
          } else {
            if (element['type']) {
              model[key] = this.parseElement(element);
            }
          }
        }
      }
    }

    return model;
  }

  public parseFormDataModel(modelDef: any, apiDef: any) {
    const model: any = [];
    const bodyName = modelDef.substring(modelDef.lastIndexOf('/') + 1);
    const def = apiDef[bodyName];
    const props = def['properties'];
    if (props) {
      for (const key in props) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          const element = props[key];
          let modelEle: any;
          if (element.hasOwnProperty('items') && element['type'] == 'array') {
            if (element["items"]['$ref']) {
              modelEle = [this.parseModel(element["items"]['$ref'], apiDef)]
            } else if (element["items"]['type']) {
              modelEle = [this.parseElement(element["items"])];
            }
            if(modelEle) {
              model.push({
                type: 'string',
                uiType: 'text',
                name: key,
                value: JSON.stringify(modelEle)
              });
            }
          } else if (element['type']) {
            model.push({
              type: element['type'],
              uiType: ((element['type'] == 'integer' || element['type'] == 'number') ? 'number' : 'text'),
              name: key,
              value: this.parseElement(element)
            });
          } else if(element['$ref']) {
            const bodyModel = this.parseModel(element['$ref'], apiDef);
            model.push({
              type: 'string',
              uiType: 'text',
              name: key,
              value: JSON.stringify(bodyModel)
            });
          }
        }
      }
    }

    return model;
  }

  public parseFormDataParaModel(parameterObj: any, dataDef: any) {
    let bodyModel: any = [];
    if (parameterObj.schema['$ref']) { // 对象类型
      bodyModel = this.parseFormDataModel(parameterObj.schema['$ref'], dataDef);
    }
    return bodyModel;
  }

  public parseElement(element: any) {
    let elementValue;
    if (element['type'].includes('integer')) {
      if (element['enum']) {
        elementValue = element['enum'][0];
      } else {
        elementValue = 0;
      }
    } else if (element['type'].includes('boolean')) {
      elementValue = false;
    } else if (element['type'].includes('string')) {
      if (element['enum']) {
        elementValue = element['enum'][0];
      } else {
        elementValue = '';
      }
    }

    // 如果有default则用default的值
    if(element['default']) {
      elementValue =  element['default'];
    }

    //如果有example则用example的值
    if (element['example']) {
      elementValue = element['example'];
    }

    return elementValue;
  }

  public parseElementType(element: any) {
    if (element['type'].includes('integer')) {
      return 'integer';
    } else if (element['type'].includes('boolean')) {
      return 'boolean';
    } else if (element['type'].includes('string')) {
      return 'string';
    }
    return 'string';
  }

  public getTotal(specDef: any) {
    const paths = specDef.paths;
    let total = 0;
    for (const pathKey in paths) {
      if (Object.prototype.hasOwnProperty.call(paths, pathKey)) {
        total++;
      }
    }
    return total;
  }

  removeExtension(filename: string) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return filename; // 没有扩展名
    }
    return filename.substring(0, lastDotIndex);
  }

  static isBrowserEnvironment() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      return true; // 浏览器环境
    } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      return false;    // Node.js 环境
    } else {
      return false;
    }
  }

  static fullTextSearch(text: string, keyword: string) {
    if (!keyword.trim()) return [];

    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    const results = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(regex)];
      if (matches.length > 0) {
        results.push({
          lineNumber: i + 1,
          content: line,
          matches: matches.map(m => ({
            start: m.index,
            end: m.index + m[0].length,
            text: m[0]
          }))
        });
      }
    }

    return results;
  }


  /**
   * 处理 ZIP 压缩上传功能 - 统一处理单个文件和文件夹
   */
  async handleZipUpload(item: AstTreeNode) {
    // 添加上传任务到主组件
    const taskId = this.addUploadTask(`${item.label}.zip`);
    try {
      // 显示上传进度提示
      console.log('开始压缩文件...');

      // 检测根目录是否包含 .git 文件夹（只检查第一层子节点）
      const hasGitFolder = this.hasGitFolderInRoot(item);
      console.log('根目录包含 .git 文件夹:', hasGitFolder);

      // 创建一个新的 ZIP 实例
      const zip = new JSZip();

      if (item.nodeType === 'file') {
        // 单个文件：直接添加文件到 ZIP（文件节点不需要转换行尾）
        await this.addFileToZip(zip, item, '', !hasGitFolder);
      } else if (item.nodeType === 'folder') {
        // 整个文件夹：递归添加所有文件到 ZIP
        await this.addFolderToZip(zip, item, item.label, hasGitFolder);
      }

      // 生成 ZIP 文件
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata: any) => {
        // ZIP 生成进度回调，更新进度
        const progress = metadata.percent / 100; // 转换为 0-1 范围
        this.updateUploadProgress(taskId, progress * 0.3); // 压缩过程占总进度的 30%
      });

      // 创建 ZIP 文件对象
      const zipFile = new File([zipBlob], `${item.label}.zip`, { type: 'application/zip' });

      // 上传 ZIP 文件
      // const directoryPath = generateDirectoryPath(this.data(), item, false); // 生成目录路径，不包含文件名
      const directoryPath = ''
      await this.uploadFileToServer(zipFile, directoryPath, taskId);
      
      console.log(`ZIP 文件上传成功：${item.label}.zip`);
      this.updateUploadProgress(taskId, 1); // 设置为 100%
      setTimeout(() => {
        this.removeUploadTask(taskId); // 上传完成后移除任务
      }, 3000);
      // 显示成功提示
      this.notificationService.showNotification(`Upload successful: ${item.label}.zip`, 'success');
    } catch (error: any) {
      console.error('ZIP 压缩或上传失败:', error);
      this.failUploadTask(taskId); // 标记为失败
      setTimeout(() => {
        this.removeUploadTask(taskId); // 移除失败任务
      }, 3000);
      // 显示失败提示
      this.notificationService.showNotification(`Upload failed: ${error.message}`, 'error');
    }
  }

  /**
   * 检查根目录下是否包含 .git 文件夹（只检查第一层子节点）
   */
  hasGitFolderInRoot(node: AstTreeNode): boolean {
    if (!node) return false;
    
    // 如果是文件节点，检查其父节点的子节点
    if (node.nodeType === 'file') {
      const parent = node.parentItem;
      if (parent && parent.children) {
        return parent.children.some((child: AstTreeNode) => 
          child.nodeType === 'folder' && child.label === '.git'
        );
      }
      return false;
    }
    
    // 如果是文件夹节点，直接检查其子节点
    if (node.nodeType === 'folder' && node.children) {
      return node.children.some((child: AstTreeNode) => 
        child.nodeType === 'folder' && child.label === '.git'
      );
    }
    
    return false;
  }

  /**
   * 判断文件是否为文本文件（需要转换行尾）
   */
  isTextFile(fileName: string): boolean {
    // 常见的文本文件扩展名（仅列出最常见的，减少判断开销）
    const textExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.java', '.c', '.cpp',
      '.h', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt',
      '.sh', '.bash', '.ps1', '.bat', '.cmd',
      '.json', '.xml', '.yaml', '.yml', '.toml', '.ini',
      '.html', '.css', '.scss', '.less',
      '.md', '.txt', '.log', '.sql',
      '.gitignore', '.gitattributes', '.editorconfig'
    ];
    
    const lowerFileName = fileName.toLowerCase();
    return textExtensions.some(ext => lowerFileName.endsWith(ext));
  }

  /**
   * 将 CRLF 转换为 LF（使用高效的 Uint8Array 操作）
   */
  convertCRLFtoLF(content: ArrayBuffer): Uint8Array {
    const bytes = new Uint8Array(content);
    
    // 先统计需要替换的数量，避免多次分配内存
    let crlfCount = 0;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { // \r\n
        crlfCount++;
      }
    }
    
    // 如果没有 CRLF，直接返回原数据
    if (crlfCount === 0) {
      return bytes;
    }
    
    // 创建新数组（长度 = 原长度 - CRLF 数量）
    const result = new Uint8Array(bytes.length - crlfCount);
    let writeIndex = 0;
    
    for (let i = 0; i < bytes.length; i++) {
      // 跳过 CR (\r)，保留 LF (\n)
      if (bytes[i] === 0x0D && i < bytes.length - 1 && bytes[i + 1] === 0x0A) {
        continue; // 跳过 \r
      }
      result[writeIndex++] = bytes[i];
    }
    
    return result;
  }

  /**
   * 将单个文件添加到 ZIP 中
   */
  async addFileToZip(zip: JSZip, fileNode: AstTreeNode, folderPath: string, shouldConvertLineEndings: boolean = false): Promise<void> {
    if (!fileNode.folderHandle) {
      console.error('No folderHandle for file node');
      return;
    }

    try {
      const fileHandle = fileNode.folderHandle as unknown as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      
      // 构造文件在 ZIP 中的路径
      const filePath = folderPath ? `${folderPath}/${fileNode.label}` : fileNode.label;
      
      // 如果需要转换行尾且是文本文件，则进行转换
      let finalContent: ArrayBuffer | Uint8Array = content;
      if (shouldConvertLineEndings && this.isTextFile(fileNode.label)) {
        console.log(`Converting line endings for: ${filePath}`);
        finalContent = this.convertCRLFtoLF(content);
      }
      
      zip.file(filePath, finalContent);
    } catch (error) {
      console.error('Error adding file to zip:', error);
      throw error;
    }
  }

  /**
   * 将整个文件夹递归添加到 ZIP 中
   */
  async addFolderToZip(zip: JSZip, folderNode: AstTreeNode, folderPath: string, shouldConvertLineEndings: boolean = false): Promise<void> {
    if (folderNode.children) {
      for (const child of folderNode.children) {
        if (child.nodeType === 'file') {
          // 文件节点：添加到 ZIP，根据需要转换行尾
          await this.addFileToZip(zip, child, folderPath, shouldConvertLineEndings);
        } else if (child.nodeType === 'folder') {
          // 文件夹节点：递归处理
          const childFolderPath = `${folderPath}/${child.label}`;
          await this.addFolderToZip(zip, child, childFolderPath, shouldConvertLineEndings);
        }
      }
    }
  }

  /**
   * 将文件上传到服务器
   */
  async uploadFileToServer(file: File, directoryPath: string, taskId: string): Promise<void> {
    const chunkSize = 1024 * 1024 * 10; // 10MB per chunk
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = this.generateUUID();
    const userId = this.userData?.username || 'Anonymous';

    // 先获取文件的完整字节数组
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // 准备表单数据并分块上传
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = fileBytes.slice(start, end);

      // 创建Blob对象来模拟文件片段
      const chunkBlob = new Blob([chunk]);
      
      const formData = new FormData();
      formData.append('chunk', chunkBlob, `${file.name}.part${i}`);
      formData.append('fileId', fileId);
      formData.append('chunkIndex', i.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileName', file.name);
      formData.append('fileSize', file.size.toString());
      formData.append('userId', userId);
      formData.append('directoryPath', directoryPath);

      try {
        // 计算上传进度 (压缩占30%，上传占70%)
        const uploadProgress = ((i + 1) / totalChunks) * 0.7 + 0.3; // 加上压缩的30%
        this.updateUploadProgress(taskId, uploadProgress);
        
        const response = await this.http.post('/user/api/chunk/upload', formData, {
          reportProgress: true,
          observe: 'events'
        }).toPromise();

      } catch (error) {
        console.error(`Error uploading chunk ${i+1} of file ${file.name}:`, error);
        throw error;
      }
    }
  }

  /**
   * 生成UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private uuid(): string {
    let s: Array<any> = [];
    const hexDigits = "0123456789abcdef";
    for (let i = 0; i < 28; i++) {
      const start = Math.floor(Math.random() * 0x10);
      s[i] = hexDigits.substring(start, start + 1);
    }
    s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
    const start1 = (s[19] & 0x3) | 0x8;
    s[19] = hexDigits.substring(start1, start1 + 1); // bits 6-7 of the clock_seq_hi_and_reserved to 01
    s[8] = s[13] = s[18] = s[23] = "-";
    s[0] = "a";

    var uuid = s.join("");
    return uuid;
  }
}

export class ConfigService {
  static microserviceListUrl = 'assets/conf/microserviceList.json'
  static authorizedUrl = "/api/oauth2/v1/usercred/access_token";
  static zAccesstokenHeaderName = "Z-ACCESS-TOKEN";
  static modifyHeaderUrlFlag = "/api";

  static cookieHeaderName = "Cookie";

  static dialogHttpsInterruptId = "dialog_https_interrupt_id";
  static dialogAuthorizeId = "dialog_authorize_id";
  static dialogTipId = "dialog_tip_id";
  static dialogServerManagerId = "dialog_server_manager_id"
  static dialogServiceManagerId = "dialog_service_manager_id"

  static luxioAppTabIdList = "luxioAppTabIdList";
  static privacyErrorDialogFlag = "privacyErrorDialogFlag";
  static ipAndPort = "ipAndPort";
  //微服务的列表是否发生了变更，如果发生变更则取值为modified， 如果还是初始的微服务列表则为raw
  static microserviceDataStatusFlag = "microserviceDataStatusFlag";
  static microserviceData = "microserviceData";


  static addServer = "addServer";
  static deleteServer = "deleteServer";
  static addService = "addService";
  static deleteService = "deleteService";
  static resetService = "resetService";

  static prefix = '/apijson/';
  static apiVersion = 'v1';
}

export enum AppEventType {
  APP_API_EXPLORER_TAB = "APP_API_EXPLORER_TAB",
  APP_USER_MANAGER_TAB = "APP_USER_MANAGER_TAB",
  APP_HISTORY_TAB = "APP_HISTORY_TAB",

  USER_CONTENT_TAB = "USER_CONTENT_TAB"
}

export class EventItem {
  eventType: AppEventType | undefined;
  data: any;
}

export enum MicroserviceDataStatus {
  raw = "raw", modified = "modified"
}


// 每个文件路径对应一个任务队列和状态
const queues = new Map<string, Array<() => Promise<void>>>();
const isWriting = new Map<string, boolean>();

/**
 * 安全写入 OPFS 文件，自动排队，避免 "Other writer have not been closed"
 * @param path 文件路径，如 '/dir/file.txt'
 * @param data 要写入的字符串（或 ArrayBuffer，取决于 opfs-tools 支持）
 */
export async function queuedWrite(path: string, data: string): Promise<void> {
  if (!queues.has(path)) {
    queues.set(path, []);
    isWriting.set(path, false);
  }

  const queue = queues.get(path)!;

  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        await write(path, data); // 👈 调用原始 opfs-tools.write
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    processQueue(path);
  });
}

async function processQueue(path: string) {
  if (isWriting.get(path) || queues.get(path)!.length === 0) return;

  isWriting.set(path, true);

  const queue = queues.get(path)!;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      await task();
    } catch (err) {
      console.error(`[OPFS Queue] Write failed for ${path}:`, err);
      // 继续处理下一个，不中断队列
    }
  }

  // 清理空队列（可选，防内存泄漏）
  queues.delete(path);
  isWriting.delete(path);
}

