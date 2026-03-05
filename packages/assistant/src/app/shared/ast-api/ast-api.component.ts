import { AfterViewInit, Component, ElementRef, Input, OnInit, afterNextRender, output, viewChild, HostListener } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstTabComponent } from '../ast-tab/ast-tab.component';
import { AstTabGroupComponent } from '../ast-tab/ast-tab-group/ast-tab-group.component';

import { FormsModule } from '@angular/forms';
import { AstSelectComponent } from '../ast-select/ast-select.component';
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { json } from "@codemirror/lang-json";

@Component({
  selector: 'ast-api',
  templateUrl: './ast-api.component.html',
  styleUrls: ['./ast-api.component.css'],
  host: {
    '(mouseup)': 'dragEnd($event)',
    '(mousemove)': 'whenMouseMove($event)',
    '[tabIndex]': '-1',
    '(keydown)': 'saveApi($event)'
  },
  standalone: true,
  imports: [FormsModule, AstSelectComponent, AstTabGroupComponent, AstTabComponent]
})
export class AstApiComponent implements OnInit, AfterViewInit {
  reqEditorContainerView = viewChild<ElementRef<HTMLElement>>('reqEditorContainer');
  editApiSourceCodeContainerView = viewChild<ElementRef<HTMLElement>>('editApiSourceCodeContainer');
  @Input() apiInfo: any;
  readonly saved = output();

  // whether the floating edit button is currently shown (mouse near right edge)
  editBtnVisible = false;
  private editBtnHideTimer: any = null;

  auths = [
    {
      value: "No Auth"
    },
    {
      value: "Basic Auth",
      parameters: [
        {
          name: "userName",
          value: ""
        },
        {
          name: "password",
          value: ""
        }
      ]
    },
    {
      value: "OAuth 2.0"
    }
  ]

  grantTypes = [
    { value: "authorization_code" },
    { value: "Implicit" },
    { value: "Resource Owner Password Credentials" },
    { value: "client_credentials" }
  ]

  clientAuthenticationOpts = [
    { value: "Headers", displayName: "Send credentials in headers" },
    { value: "Body", displayName: "Send credentials in body" }
  ]

  consumeOpts = [
    {
      value: "None"
    },
    {
      value: "application/json"
    },
    {
      value: "application/xml"
    },
    {
      value: "application/x-www-form-urlencoded"
    }
  ]

  rawQueryOrPathParasCount = 0;
  rawHeaderParasCount = 0;

  private editorView!: EditorView;

  gotResponse = false;

  ifSendingRequest = false;
  requestDuration: string = "0";
  response: {
        status?: number | string;
        statusText?: string;
        body?: string;//响应体统一转换成字符串
  } = {};
  // 创建一个新的 AbortController 实例  
  controller: AbortController | undefined;
  
  editApiSourceCodeEnable = false;

  /**
   * 标志API内容是否发生了改变， 用于保存时做判断
   */
  ifChangedFlag: boolean = true;

  constructor() {
    afterNextRender(() => {
      this.updateReqEditorContainerView();
    });
  }

  ngOnInit() {
    const parameters = this.apiInfo.rawApiInfo.parameters;
    if (parameters) {
      for (let index = 0; index < parameters.length; index++) {
        const parameter = parameters[index];
        if (parameter.in == "query" || parameter.in == "path") {
          this.rawQueryOrPathParasCount++;
        } else if (parameter.in == "body") {
          //support openapi 2.0
          parameter.name = parameter.name.charAt(0).toUpperCase() + parameter.name.slice(1)
        } else if (parameter.in == "formData") {
          //support openapi 2.0
        } else if (parameter.in == "header") {
          this.rawHeaderParasCount++;
        }
      }
    }
  }

  methodChange(evt: any) {
    this.apiInfo.method = evt.value;
    this.apiInfo.symbol = this.apiInfo.method.toUpperCase()
  }

  authTypeChange(evt: any) {
    this.apiInfo.auth.authType = evt.value;
    this.apiInfo.auth.grantType = 'authorization_code';
    this.apiInfo.auth.clientAuthentication = 'Headers';
  }

  grantTypeChange(evt: any) {
    this.apiInfo.auth.grantType = evt.value;
  }

  clientAuthenticationChange(evt: any) {
    this.apiInfo.auth.clientAuthentication = evt.value;
  }

  async generateOAuth2Token() {
    // TODO 生成OAuth2.0 Token
    // 1. 获取访问令牌
    const accessToken = await this.getAccessToken(this.apiInfo);
    this.apiInfo.auth.token = accessToken
  }

  multiInputfocusFn(evt: any, parameter: any, valIndex: any) {
    let isLast = parameter.value.length == valIndex + 1;
    if (isLast) {
      this.addParaValue(parameter)
    }
  }

  multiInputblurFn(evt: any, parameter: any, valIndex: any) {
    let isLast = parameter.value.length == valIndex + 1;
    if (!isLast && parameter.value[valIndex].value == "") {
      this.deleteParaValue(parameter, valIndex)
    }
  }

  addParaValue(parameter: any) {
    if (parameter.value == null) {
      parameter.value = []
    }
    parameter.value.push({
      value: ""
    })
  }

  deleteParaValue(parameter: any, index: number) {
    parameter.value.splice(index, 1)
  }

  
  addCustomParams(customParamsArray: any) {
    customParamsArray.push(
      { 
        name: '',
        value: '' 
      }
    )
  }

  deleteCustomParams(parameter: any, index: number) {
    parameter.splice(index, 1)
  }

  customParamKeyFocus(evt: any, customParamsArray: any, paraIndex: number) {
    let isLast = customParamsArray.length == paraIndex + 1;
    if (isLast) {
      this.addCustomParams(customParamsArray)
    }
  }

  customParamKeyBlur(evt: any, customParamsArray: any, paraIndex: number) {
    let isLast = customParamsArray.length == paraIndex + 1;
    if (!isLast && customParamsArray[paraIndex].name == "") {
      this.deleteCustomParams(customParamsArray, paraIndex)
    }
  }
  customParamValueFocus(evt: any, customParamsArray: any, paraIndex: number) {
    let isLast = customParamsArray.length == paraIndex + 1;
    if (isLast) {
      this.addCustomParams(customParamsArray)
    }
  }

  customParamValueBlur(evt: any, customParamsArray: any, paraIndex: number) {
    let isLast = customParamsArray.length == paraIndex + 1;
    if (!isLast && customParamsArray[paraIndex].value == "") {
      this.deleteCustomParams(customParamsArray, paraIndex)
    }
  }

  consumeChange(evt: any ) {
    this.apiInfo.currentConsume = evt.value;
    setTimeout(()=> {
      this.updateReqEditorContainerView();
    }, 0)
  }

  private updateReqEditorContainerView() {
    const domView = this.reqEditorContainerView();
    let doc = ''
    if (domView) {
      if (!this.apiInfo['currentConsume']) {
        doc = ''
      } else if (!this.apiInfo.requestBody) {
        doc = ''
      } else if (!this.apiInfo.requestBody['content']) {
        doc = ''
      } else {
        doc = this.apiInfo.requestBody['content'][this.apiInfo['currentConsume']] || ""
      }
      this.editorView = new EditorView({
        doc: doc,
        parent: domView.nativeElement,
        extensions: [basicSetup, json(),
          EditorView.theme({
            '&': {
              height: '100%',
              minHeight: '0',
              fontFamily: 'Consolas',
              border: 'none', // 移除边框
              outline: 'none', // 可选：移除聚焦时的 outline
              boxShadow: 'none',
            },
            '.cm-scroller': {
              height: '100%',
              overflow: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#ccc transparent',
            },
          })
        ],
      });
    }
  }

  /**
   * 获取 OAuth 2.0 访问令牌
   * @returns {Promise<string>} 访问令牌
   */
  async getAccessToken(apiInfo: any) {
    const auth = apiInfo.auth;
    if (auth == null) {
      throw new Error('OAuth2.0认证信息未配置');
    }
    const CLIENT_ID = auth.clientId;
    const CLIENT_SECRET = auth.clientSecret;
    const SCOPE = auth.scopes;

    if (this.apiInfo.auth.grantType == 'client_credentials') {
      try {
        console.log('正在获取访问令牌...');

        // 构造请求头
        const headerParams: any = {
          'Content-Type': 'application/x-www-form-urlencoded'
        };
        // 构造请求体 (使用 client_credentials 流)
        const bodyParams = new URLSearchParams();
        bodyParams.append('grant_type', 'client_credentials');
        if (SCOPE) {
          bodyParams.append('scope', SCOPE);
        }

        if(this.apiInfo.auth.clientAuthentication == 'Body') {
          bodyParams.append('client_id', CLIENT_ID);
          bodyParams.append('client_secret', CLIENT_SECRET);
        } else {
          // 如果是 Headers 方式，则在后续的 fetch 请求中添加 Authorization 头
          headerParams['Authorization'] = 'Basic ' + btoa(CLIENT_ID + ':' + CLIENT_SECRET);
        }

        const response = await fetch(auth.tokenEndpoint, {
          method: 'POST',
          headers: headerParams,
          body: bodyParams.toString()
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`获取令牌失败: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`);
        }

        const tokenData = await response.json();
        console.log('令牌获取成功:', tokenData);
        return tokenData.access_token;
      } catch (error) {
        console.error('获取访问令牌时出错:', error);
        throw error;
      }
    } else if (this.apiInfo.auth.grantType == 'Resource Owner Password Credentials') {

    } else if (this.apiInfo.auth.grantType == 'authorization_code') {
        // ========== 配置：替换为你在本地 OAuth 服务注册的客户端信息 ==========
        const config = {
            clientId: this.apiInfo.auth.clientId,           // 替换为你的 client_id
            clientSecret: this.apiInfo.auth.clientSecret,   // 替换为你的 client_secret
            redirectUri: this.apiInfo.auth.redirectURI, // 必须与注册的 redirect_uri 一致
            authUrl: this.apiInfo.auth.authorizationEndpoint,
            tokenUrl: this.apiInfo.auth.tokenEndpoint,
            scope: this.apiInfo.auth.scopes // 可选: 'openid profile email' 如果服务支持
        };

        // 从 URL 获取参数
        function getUrlParams() {
            const params = new URLSearchParams(window.location.search);
            return Object.fromEntries(params.entries());
        }

        // 构建授权 URL 并跳转
        function redirectToAuth() {
            const state = Math.random().toString(36).substring(2);
            const nonce = Math.random().toString(36).substring(2); // OpenID Connect 推荐使用 nonce
            const authUrl = new URL(config.authUrl);
            authUrl.searchParams.append('client_id', config.clientId);
            authUrl.searchParams.append('redirect_uri', config.redirectUri);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('scope', config.scope);
            authUrl.searchParams.append('state', state);
            authUrl.searchParams.append('nonce', nonce); // 用于 ID Token 验证
            authUrl.searchParams.append('access_type', 'offline'); // 请求 refresh_token（如果支持）

            const newTab = window.open(authUrl.toString(), '_blank');
        }

        // // 使用授权码换取 Token
        // async function exchangeCodeForToken(code: any) {
        //     try {
        //         const response = await fetch(config.tokenUrl, {
        //             method: 'POST',
        //             headers: {
        //                 'Content-Type': 'application/x-www-form-urlencoded',
        //                 'Authorization': 'Basic ' + btoa(config.clientId + ':' + config.clientSecret)
        //             },
        //             body: new URLSearchParams({
        //                 // 'client_id': config.clientId,
        //                 // 'client_secret': config.clientSecret,
        //                 'code': code,
        //                 'redirect_uri': config.redirectUri,
        //                 'grant_type': 'authorization_code'
        //             })
        //         });

        //         if (!response.ok) {
        //             const errorText = await response.text();
        //             throw new Error(`HTTP ${response.status}: ${errorText}`);
        //         }

        //         const tokenData = await response.json();
        //         console.log('Token Response:', tokenData);

        //         // 可选：清除 URL 参数
        //         // history.replaceState({}, document.title, window.location.pathname);
        //     } catch (error) {
        //         console.error('Token Exchange Error:', error);
        //     }
        // }

        // // 页面初始化
        // document.addEventListener('DOMContentLoaded', () => {
        //     const loginBtn = document.getElementById('loginBtn');
        //     const urlParams = getUrlParams();

        //     if (urlParams.code) {
        //         // 已收到授权码
        //         loginBtn.style.display = 'none';
        //         exchangeCodeForToken(urlParams.code);
        //     } else {

        //     }
        // });

        redirectToAuth();
    } else if (this.apiInfo.auth.grantType == 'Implicit') {

    } else {

    }
  }

  getEditorContent(): string {
    return this.editorView.state.doc.toString();
  }

  sendRequest() {
    const apiInfo = this.apiInfo
    let reuqestUrl = this.getRequestUrl(apiInfo);

    //TODO 根据参数类型构造请求头和请求体,apiInfo['parameterHasFormDataVer2']表示有formData参数，暂时未区分具体的content-type，待改造
    let header = apiInfo['parameterHasFormDataVer2'] ? 'application/x-www-form-urlencoded' : 
                ((apiInfo['parameterHasBody']) ? apiInfo['currentConsume'] : 'application/json');

    let headers: any = {
      'Content-Type': header
    }
    const headerParas = this.getHeadersParams(apiInfo, apiInfo.rawApiInfo.parameters || []);
    // 合并自定义头参数
    Object.assign(headers, headerParas);
    // 构造 Basic Auth 头
    this.addAuthHeader(apiInfo, headers);

    let body;
    if (apiInfo.method.toUpperCase() == "POST" || apiInfo.method.toUpperCase() == "PUT") {
      if(apiInfo['currentConsume'] == 'application/json' && apiInfo.requestBody != null) {
        body = this.getEditorContent();
      } else if(apiInfo['parameterHasFormDataVer2']) {
        body = this.getRequestFormData(apiInfo.rawApiInfo);
      } else if(apiInfo['currentConsume'] == 'application/x-www-form-urlencoded') {
        for (const key of apiInfo["requestBody"]["content"][apiInfo['currentConsume']]) {
          if (body == null || body == '') {
            body = key.name + "=" + key.value;
          } else {
            body = body + "&" + key.name + "=" + key.value;
          }
        }
      } else {
        body = "";
      }
    } else {
      body = "";
    }

    this.ifSendingRequest = true;
    const startTime = Date.now(); // 记录开始时间

    this.controller = new AbortController();
    const signal = this.controller.signal;

    // 使用 fetch 发送请求，并传递 signal  
    fetch(reuqestUrl, {
      method: apiInfo.method.toUpperCase(),
      headers: headers,
      body: ['GET', 'HEAD'].includes(apiInfo.method.toUpperCase()) ? null : body,
      signal: signal
    })
      .then(response => {
        if (!response.ok) {
          this.response = {
            status: response.status,
            statusText: response.statusText,
            body: ""
          }

          const endTime = Date.now(); // 即使在错误的情况下也记录结束时间  
          this.requestDuration = this.formatDuration(endTime - startTime);
          this.ifSendingRequest = false;
          throw new Error('Network response was not ok.');
        }
        const endTime = Date.now(); // 记录结束时间  
        this.requestDuration = this.formatDuration(endTime - startTime);   // 计算耗时  

        this.ifSendingRequest = false;
        this.response = {
          status: response.status,
          statusText: response.statusText
        }
        let responseClone = response.clone();
        return response.json()   // 解析为json 
          .catch(error => {
            // 如果解析 JSON 失败，则回退到文本解析
            return responseClone.text();
          });
      })
      .then(data => {
        this.gotResponse = true;
        // 此时 data 可能是 JSON 对象，也可能是文本字符串  
        if (typeof data === 'object') {
          // 假设 data 是 JSON 对象，你可以在这里处理它  
          console.log('Received JSON:', data);
          this.response.body = JSON.stringify(data, null, 4);
        } else {
          // 假设 data 是文本字符串，你可以在这里处理它  
          console.log('Received text:', data);
          this.response.body = data;
        }
      })
      .catch(error => {
        // 错误处理  
        console.error('There has been a problem with your fetch operation:', error);
      });
  }

  formatDuration(milliseconds: number) {
    let totalSeconds = Math.floor(milliseconds / 1000);
    let seconds: any = totalSeconds % 60;
    let minutes: any = Math.floor(totalSeconds / 60) % 60;
    let hours: any = Math.floor(totalSeconds / (60 * 60));

    // 毫秒部分  
    let millisecondsPart: any = Math.floor(milliseconds % 1000);
    // 毫秒不足三位时前面补0  
    millisecondsPart = millisecondsPart.toString().padStart(3, '0');

    // 时分秒不足两位时前面补0  
    hours = hours.toString().padStart(2, '0');
    minutes = minutes.toString().padStart(2, '0');
    seconds = seconds.toString().padStart(2, '0');

    // 返回格式化的字符串  
    return `${hours}h${minutes}m${seconds}s${millisecondsPart}ms`;
  }

  clickAbortRequest() {
    // 如果你想取消请求，调用 controller 的 abort 方法
    if (this.controller) {
      this.controller.abort();
      this.ifSendingRequest = false;
    }
  }

  private getRequestUrl(apiInfo: any) {
    let reuqestUrl = apiInfo.url;

    const requestParameters = apiInfo.rawApiInfo.parameters || [];
    if (requestParameters == null) {
      return reuqestUrl;
    }

    for (const element of requestParameters) {
      if (element.in == "path") {
        reuqestUrl = reuqestUrl.replace("{" + element.name + "}", element.value);
      }
    }

    let queryParams = this.getQueryParams(apiInfo, requestParameters);
    reuqestUrl = queryParams.length > 0 ? (reuqestUrl + "?" + queryParams.join("&")) : reuqestUrl;

    return reuqestUrl;
  }

  private addAuthHeader(apiInfo: any, headers: any) {
    const env = CoreService.isBrowserEnvironment();
    if (apiInfo.auth.authType == "Basic Auth" && apiInfo.auth != null) {
      if (env) {
        const credentials = btoa(`${apiInfo.auth.username}:${apiInfo.auth.passWord}`); // btoa 是浏览器内置的 Base64 编码函数
        headers['Authorization'] = `Basic ${credentials}`;
      } else {
        const buffer = Buffer.from(`${apiInfo.auth.username}:${apiInfo.auth.passWord}`);
        const credentials = buffer.toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
      }
    } else if (apiInfo.auth.authType == "OAuth 2.0" && apiInfo.auth != null) {
      if( apiInfo.auth.token != null || apiInfo.auth.token != '') {
        headers['Authorization'] = `Bearer ${apiInfo.auth.token}`;
      }
    }
  }

  private getHeadersParams(apiInfo: any, requestParameters: any) {
    let headersParams = [];
    for (const element of requestParameters) {
      if (element.in == "header") {
         headersParams[element.name] = element.value
      }
    }

    if (apiInfo.customHeaderparameters) {
      for (let index = 0; index < apiInfo.customHeaderparameters.length; index++) {
        const paras = apiInfo.customHeaderparameters[index];
        if (paras.name != '' && paras.value != '' && paras.name != null && paras.value != null) {
          headersParams[paras.name] = paras.value
        }
      }
    }

    return headersParams;
  }

  private getQueryParams(apiInfo: any, requestParameters: any) {
    let queryParams = [];
    for (const element of requestParameters) {
      if (element.in == "query") {
        if (element.type == "array" || (element.schema != null && element.schema.type == 'array')) {
          if (element.value != null) {
            for (let index = 0; index < element.value.length; index++) {
              queryParams.push(element.name + "=" + element.value[index].value);
            }
          }
        } else {
          queryParams.push(element.name + "=" + element.value);
        }
      }
    }

    if (apiInfo.customQueryparameters) {
      for (let index = 0; index < apiInfo.customQueryparameters.length; index++) {
        const paras = apiInfo.customQueryparameters[index];
        if (paras.name != '' && paras.value != '' && paras.name != null && paras.value != null) {
          queryParams.push(paras.name + "=" + paras.value)
        }
      }
    }

    return queryParams;
  }

  private getRequestFormData(rawApiInfo: any) {
    let formData = '';
    const requestParameters = rawApiInfo.parameters;
    if (requestParameters == null) {
      return "";
    }

    let first = 0;
    for (const element of requestParameters) {
      if (element.in == "formData") {
        if (first == 0) {
          formData = element.name + "=" + element.value;
        } else {
          formData = formData + "&" + element.name + "=" + element.value;
        }
        first++;
      }
    }
    return formData;
  }

  ngAfterViewInit(): void {
    // this.initializeMonacoEditor();
  }

  methodOptions = [
    { value: 'GET', displayName: 'GET', color: CoreService.getSymbolColor('get') },
    { value: 'POST', displayName: 'POST', color: CoreService.getSymbolColor('post') },
    { value: 'PUT', displayName: 'PUT', color: CoreService.getSymbolColor('put') },
    { value: 'DELETE', displayName: 'DELETE', color: CoreService.getSymbolColor('delete') },
    { value: 'PATCH', displayName: 'PATCH', color: CoreService.getSymbolColor('patch') },
    { value: 'HEAD', displayName: 'HEAD', color: CoreService.getSymbolColor('head') },
    { value: 'OPTIONS', displayName: 'OPTIONS', color: CoreService.getSymbolColor('options') },
  ];

  onChange(evt: any) {
    console.log('Selected value:', evt);
    this.apiInfo.symbol = this.apiInfo.method.toUpperCase()
  }

  onParamsClickTab(evt: any) {

  }

  onBodyClickTab(evt: any) {

  }

  onHeadersClickTab(evt: any) {

  }

  onAuthClickTab(evt: any) {

  }

  inputValueChange(val: any, index: any) {

  }

  queryparamKeypress(paraIndex: number) {
    let isLast = this.apiInfo.customQueryparameters.length = paraIndex + 1;
    if (isLast) {
      this.apiInfo.customQueryparameters.push(
        {
          name: '',
          value: ''
        }
      )
    }
  }

  headerparamKeypress(paraIndex: number) {
    let isLast = this.apiInfo.customHeaderparameters.length = paraIndex + 1;
    if (isLast) {
      this.apiInfo.customHeaderparameters.push(
        {
          name: '',
          value: ''
        }
      )
    }
  }

  dragHeight: number = 0.6;
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
      return;
    }

    const threshold = 50; // px from right edge
    const x = evt.clientX;
    const w = window.innerWidth;
    const shouldShow = w - x < threshold;
    if (shouldShow) {
      if (this.editBtnHideTimer) {
        clearTimeout(this.editBtnHideTimer);
        this.editBtnHideTimer = null;
      }
      if (!this.editBtnVisible) {
        this.editBtnVisible = true;
      }
    } else {
      if (this.editBtnVisible && this.editBtnHideTimer == null) {
        this.editBtnHideTimer = setTimeout(() => {
          this.editBtnVisible = false;
          this.editBtnHideTimer = null;
        }, 3000);
      }
    }
  }

  public saveApi(evt: KeyboardEvent) {
    if (evt.code == "KeyS" && (navigator.platform.match("Mac") ? evt.metaKey : evt.ctrlKey)) {
      evt.preventDefault();
      //如果api已经保存了,则不需要再次保存
      if (this.apiInfo['saved']) {
        return;
      }
      this.apiInfo['saved'] = true;
      if (this.ifChangedFlag) {
        this.saved.emit(this.apiInfo);
        this.ifChangedFlag = false;
      }
    }
    // 检查是否按下 ESC 键
    if (evt.key === 'Escape') {
      const target: any = evt.target;

      // 判断目标是否是我们关心的可编辑元素
      if (target.matches('input[type="text"], textarea, [contenteditable="true"]')) {
        // 阻止默认行为（可选）
        evt.preventDefault();
        this.apiBackFn();
      }
    }
  }

  setEditStatus(evt: KeyboardEvent, ifChangedFlag: boolean) {
    if (evt.code == "KeyS" && (navigator.platform.match("Mac") ? evt.metaKey : evt.ctrlKey)) {
      return;
    }
    this.ifChangedFlag = ifChangedFlag;
  }

  editApiSourceCodeFn(evt: any) {
    // 阻止默认行为（可选）
    evt.preventDefault();
    this.editApiSourceCodeEnable = true;
    // 替代 setTimeout. 确保在下一次渲染周期后执行代码  setTimeout虽然也可以，但存在潜在的未渲染完成时就执行的可能。requestAnimationFrame比setTimeout更可靠。
    requestAnimationFrame(() => {
      const domView = this.editApiSourceCodeContainerView();
      let doc = JSON.stringify(this.apiInfo, null, 4)
      if (domView) {
        this.editorView = new EditorView({
          doc: doc,
          parent: domView.nativeElement,
          extensions: [basicSetup, json(), EditorView.lineWrapping, // ✅ 正确用法 启用软换行（soft wrapping）
            EditorView.theme({
              '&': {
                height: '100%',
                minHeight: '0',
                fontFamily: 'Consolas',
                border: 'none', // 移除边框
                outline: 'none', // 可选：移除聚焦时的 outline
                boxShadow: 'none',
              },
              '.cm-scroller': {
                height: '100%',
                overflow: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: '#ccc transparent',
              },
            })
          ],
        });
        // 👇 关键：主动聚焦，显示光标
        this.editorView.focus();
        this.createEscHint(); // 创建并显示提示
      }
    })
  }

  removeTimer: any = null;      // 自动移除的定时器
  showEscHint: boolean = true;
  // 创建并显示提示
  createEscHint() {
    // 如果已有提示，先清理（防重复）
    this.removeEscHint();
    this.showEscHint = true;

    let me =this;
    // 启动 1 秒后自动移除
    this.removeTimer = setTimeout(() => {
      me.showEscHint = false;
    }, 3000);
  }

  // 立即移除提示（包括清除定时器）
  removeEscHint() {
    if (this.removeTimer) {
      clearTimeout(this.removeTimer);
      this.removeTimer = null;
    }
    this.showEscHint = false;
  }

  apiBackFn() {
    //组件销毁,防止内存泄漏。
    this.editorView.destroy()
    this.removeEscHint(); // 立即移除提示（包括清除定时器）
    this.editApiSourceCodeEnable = false;
  }

  apiSaveFn() {

  }
}
