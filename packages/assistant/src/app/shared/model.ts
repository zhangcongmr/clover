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
    /**
     * Basic properties
     */
    id: string;
    label: string;
    children: Array<AstTreeNode>;

    /**
     * Advanced properties
     *
     */
    nodeType?: TreeNodeType;
    parentItem?: any,
    deepLevel?: number;
    isExpanded?: boolean;

    /**
     * Local properties
     */
    isLocal?: boolean;
    rootPath?: string;  // Absolute path root for local projects
    /**
     * locked node cannot be edited or deleted, but can be viewed and copied
     */
    isLocked?: boolean;

    /**
     * node status properties
     */
    isActive?: boolean;
    hideActiveStatus?: boolean;//当激活了其它的节点的类型为folder的节点被激活时，隐藏非folder节点的激活状态
    isDeleted?: boolean; //当文件被删除时，标记该节点为已删除状态，但不从树中移除，用户可以选择恢复或者永久删除
    isSelected?: boolean; //用于位置选择器中标记选中的节点

    /**
     * Icon identifier for file type (e.g. 'icon-file', 'icon-file-js', 'icon-file-json')
     */
    fileIcon?: string;

    /**
     * New data properties
     */
    isNewData?: boolean;

    /**
     * Folder/File properties (folder/file)
     */
    content?: string; // file content
    rename?: boolean  // rename file or folder
    folderHandle?: FileSystemHandle; // folder/ file handle
    mode?: 'read' | 'readwrite' // folder read/write mode, default is readwrite, when set to read, the folder and its children nodes are not allowed to be modified, but can be read and added to other folders with readwrite mode

    /**
     * Api properties (api)
     */
    servers?: Array<string>;
    auth?: any;
    folder?: string;
    folderInfo?: {
        servers: Array<any>
    };
    serviceName?: string;
    method?: string;
    symbol?: string;
    symbolColor?: string;
    path?: string;
    url?: string;
    summary?: string;
    rawApiInfo?: any;
    server?: any;
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
    customQueryparameters?: Array<any>;
    customHeaderparameters?: Array<any>;
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