import { importProvidersFrom, provideZonelessChangeDetection } from '@angular/core';

import { AppComponent } from './app/app.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { withInterceptorsFromDi, provideHttpClient } from '@angular/common/http';
import { provideMyConfig } from './app/my-config.providers';
import { injectSvgSprite } from './svg-sprite.const';

//svg sprite 注入到 DOM
injectSvgSprite();

// 👇 新增：定义启动函数
export function startAngularApp(config?: { apiUrl?: string; timeout?: number }) {
  const defaultConfig = {
    apiUrl: 'https://api.example.com',
    timeout: 5000,
    ...config
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