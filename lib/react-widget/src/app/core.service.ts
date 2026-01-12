class CoreService {

  public parseOpenApiSpec(rawSpecDef: any, currentServer?: any, serviceName?: string) {
    let apiInfos: any = [];
    const currentTimeStamp = new Date().toISOString();
    const folder = (rawSpecDef?.info?.title ?? 'API collection') + " - " + currentTimeStamp;
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
                folder: folder,
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

export interface ApiTreeNodeType {
    id: string;
    label: string;
    children: Array<ApiTreeNodeType>;
    isExpanded?: boolean;
    nodeType?: 'root' | 'parent' | 'leaf';
    isNewData?: boolean;

    servers?: Array<string>;
    folder?: string;
    folderInfo?: {
        servers: Array<any>
    };
    serviceName?: string;
    method?: string;
    symbol?: string;
    path?: string;
    url?: string;
    summary?: string;
    tabLabel?: string;
    rawApiInfo?: any;
    server?: any;
    parentItem?: any,
    symbolColor?: string;
    consumes?: Array<any>;
    produces?: Array<any>;
    currentConsume?: string;
    requestBody?: any; //适用于openapi 3.0
    response?: {
        status?: number | string;
        statusText?: string;
        body?: string;//响应体统一转换成字符串
    };
    parameterHasBody?: boolean;
    parameterHasFormDataVer2?: boolean; //区分openapi 2.0
    isActive?: boolean;
    custom?: boolean;
    customQueryparameters?: Array<any>;
    customHeaderparameters?: Array<any>;
    auth?: any;
    rename?: boolean
}

export const coreService = new CoreService();