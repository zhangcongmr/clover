import { NodeDef, OpenApiV3Document } from "@luxio/common";

export class ServiceRouteInfo {
    namespace?: string;
    serviceName?: string;
    serviceVersion?: string;
    publishProtocol?: string;
    publishPort?: number;
    routeType?: string;
    routeName?: string;
    routeVersion?: string;
    publishUrl?: string;
    specUrl?: string;
    id?: string;
    label?: string;
}

export class BaseModel {
    first  = 5;
    second = "159";
    third = "26";
    additional = "66";
    value = "8";

}

export class ServerAndServiceInfo {
    server?: any;//  server.value  schemes + ip + port; eg: https://127.0.0.1:8080 、http://127.0.0.1:8080
    serviceRoute?: ServiceRouteInfo;
}
export type TreeNodeType = "folder" | "file" | "bookmark" | "api";
export type TargetTreeNodeType = "exclude-folder" | "any";
export const NoN_SELECTION = 'NoN_SELECTION'

export interface AstTreeNode {
    id: string;
    label: string;
    children: Array<AstTreeNode>;
    deepLevel?: number;
    isExpanded?: boolean;
    isLocal?: boolean;
    nodeType?: TreeNodeType;
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
    hideActiveStatus?: boolean;//当激活了其它的节点的类型为folder的节点被激活时，隐藏非folder节点的激活状态
    custom?: boolean;
    customQueryparameters?: Array<any>;
    customHeaderparameters?: Array<any>;
    content?: string;
    auth?: any;
    rename?: boolean
}

export interface AstTreeNodeWithHd extends AstTreeNode {
    folderHandle: any;
    mode: 'read' | 'readwrite'
}
export interface UserInfo {
  id: string;
  username?: string | null;
  password?: string | null;
  grant_type?: string | null;
  points?: number | null;
  coupons?: number | null;
  shoppingcards?: number | null;
  avatar?: string | null;
  phone?: string | null;
  email?: string | null;
  createtime?: string | null;
  updatetime?: string | null;
}

export interface DocModel {
    dataList?: Array<any>;
    openedList?: Array<any>;
}

export type DocModelTypeChoice = string | DocModel | NodeDef | OpenApiV3Document
export type DocModelType = DocModelTypeChoice | (() => DocModelTypeChoice) | (() => Promise<DocModelTypeChoice>);