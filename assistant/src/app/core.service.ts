import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { file, write } from 'opfs-tools';
import { ServiceRouteInfo, ApiTreeNodeType } from './shared/model';

@Injectable({
  providedIn: 'root'
})
export class CoreService {
  private http = inject(HttpClient);

  // public publishSpecDefSubject = new Subject();
  public forcePrivacyVisitSubject = new Subject();

  public scrollIntoViewSubject = new Subject();

  // public selectedServerAndServiceInfo: ServerAndServiceInfo = new ServerAndServiceInfo();

  public dialogSubject = new Subject();

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
    this.http.post(url, data).subscribe((res: any) => {
      switch (res.type) {
        case HttpEventType.UploadProgress:
          console.log('Uploaded ' + res.loaded + ' out of ' + res.total + ' bytes');
          break;
        case HttpEventType.Response:
          console.log('Finished uploading!');
          break;
      }
    });
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
    this.dialogSubject.next({
      action: "open",
      id: ConfigService.dialogHttpsInterruptId,
      data: {
        // targetUrl: this.getSpecUrl(),
        targetUrl: url,
      }
    });
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

              const apiInfo: ApiTreeNodeType = {
                id: this.uuid(),
                folderInfo: {
                  servers: rawSpecDef.servers ? rawSpecDef.servers : [],
                },
                serviceName: serviceName ? serviceName : '',
                method: methodInfoKey,
                symbol: methodInfoKey.toUpperCase(),
                path: pathKey,
                url: url,
                summary: methodInfos[methodInfoKey].summary,
                label: pathKey,
                tabLabel: methodInfoKey.toUpperCase() + "  " + pathKey,
                rawApiInfo: methodInfos[methodInfoKey],
                server: currentServer,
                // parentItem: parentItemCopy,
                symbolColor: CoreService.getSymbolColor(methodInfoKey.toUpperCase()),
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


