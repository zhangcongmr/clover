import { enableProdMode } from "@angular/core";
import { environment } from "./environments/environment";
import { startAngularApp } from "./main.common";


if (environment.production) {
  enableProdMode();
}

/**
 * 
 * 启动主应用, main.common.ts 中只定义启动入口函数
 */
startAngularApp();