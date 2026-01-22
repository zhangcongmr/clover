/**
 * 当本项目导出为依赖时, 需要添加此index.ts文件，方便第三方应用加载内部js脚本
 * inlined-styles.ts需要在运行npm run build:common才会生成
 */
import { GLOBAL_STYLES } from './inlined-styles';

const appendInlineStyle = (text: string) => {
  // 动态创建 <style> 标签并插入全局样式
  const styleEl = document.createElement('style');
  styleEl.textContent = text;
  document.head.appendChild(styleEl);
};


export const loadAstApp = () => {
  // 使用
  appendInlineStyle(GLOBAL_STYLES);

  // @ts-ignore: js is generated in dist/
  import('./assistant-common/browser/scripts.js');
  // @ts-ignore: js is generated in dist/
  return import('./assistant-common/browser/main.js')
    .then(m => {
      return m.startAngularApp
    })
    .catch(err => {
      console.error('Cannot import ', err);
    });
}
