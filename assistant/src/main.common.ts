import { importProvidersFrom, provideZonelessChangeDetection } from '@angular/core';

import { AppComponent } from './app/app.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { withInterceptorsFromDi, provideHttpClient } from '@angular/common/http';
import { provideMyConfig } from './app/my-config.providers';
import { injectSvgSprite } from './svg-sprite.const';
import { loadCommunityWidget } from '@luxio/community-widget';
import { DocModel } from './app/shared/model';

//svg sprite 注入到 DOM
injectSvgSprite();

loadCommunityWidget().then(() => {
  console.log('Community widget loaded!');
  // 此时 IIFE 已执行，可能已自动挂载到页面
});

// 👇 新增：定义启动函数
export function startAngularApp(doc?: string | any | (() => string | DocModel)) {
  const defaultConfig = {
    doc: doc
  };

  // console.log(environment)

  return bootstrapApplication(AppComponent, {
    providers: [
      provideMyConfig(defaultConfig),
      provideZonelessChangeDetection(),
      importProvidersFrom(BrowserModule, FormsModule, ReactiveFormsModule),
      provideHttpClient(withInterceptorsFromDi()),
      provideClientHydration(withEventReplay())
    ]
  }).catch(err => {
    console.log("00000000000000000000");
    console.error('Angular 应用初始化失败：', err);
    throw err; // 可选：让调用者能捕获错误
  });
}