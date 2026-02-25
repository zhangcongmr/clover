import { enableProdMode } from "@angular/core";
import { environment } from "./environments/environment";
import { file, write } from 'opfs-tools';
import { startAngularApp } from "./main.common";


if (environment.production) {
  enableProdMode();
}


const initData = async () => {
  let dataAny: any = {};
  const readDataListText = await file('/dir/file.txt').text();
  if (readDataListText) {
    dataAny.dataList = JSON.parse(readDataListText);
  }

  const openedListText = await file('/dir/openedList.txt').text();
  if (openedListText) {
    dataAny.openedList = JSON.parse(openedListText);
  }
  return dataAny;
}


/**
 * 
 * 启动主应用, main.common.ts 中只定义启动入口函数
 */
startAngularApp(initData);