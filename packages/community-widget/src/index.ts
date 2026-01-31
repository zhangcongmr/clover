/**
 * 当本项目导出为依赖时, 需要添加此index.ts文件，方便第三方应用加载内部js脚本
 * community-widget.iife.js 需要在运行npm run build:lib之后才会生成
 */
  // @ts-ignore: js is generated in dist/
  export const loadCommunityWidget = () => import('./community-widget.iife.js');
