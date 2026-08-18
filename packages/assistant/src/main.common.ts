import { importProvidersFrom, provideZonelessChangeDetection } from '@angular/core';

import { AppComponent } from './app/app.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { BrowserModule, bootstrapApplication, provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { withInterceptorsFromDi, provideHttpClient, withFetch } from '@angular/common/http';
import { provideMyConfig } from './app/my-config.providers';
import { injectSvgSprite } from './svg-sprite.const';
import { loadCommunityWidget } from '@julyware/community-widget';
import { DocModelType } from './app/shared/model';
import {A2UI_RENDERER_CONFIG, A2uiRendererService, BasicCatalog, provideMarkdownRenderer} from '@a2ui/angular/v0_9';
import { IMAGE_CONFIG } from '@angular/common';
import {renderMarkdown} from '@a2ui/markdown-it';

//svg sprite 注入到 DOM
injectSvgSprite();

loadCommunityWidget().then(() => {
  // 此时 IIFE 已执行，可能已自动挂载到页面
});

// 👇 新增：定义启动函数
export function startAngularApp(doc?: DocModelType, fileName?: string) {
  const defaultConfig = {
    doc: doc,
    fileName: fileName
  };

  // console.log(environment)

  return bootstrapApplication(AppComponent, {
    providers: [
      provideMyConfig(defaultConfig),
      provideZonelessChangeDetection(),
      importProvidersFrom(BrowserModule, FormsModule, ReactiveFormsModule),
      provideHttpClient(withFetch(), withInterceptorsFromDi()),
      provideClientHydration(withEventReplay()),
      {
        provide: A2UI_RENDERER_CONFIG,
        useValue: {
          catalogs: [new BasicCatalog()],
          actionHandler: (action: any) => {
            console.log('Action received:', action);
          },
        },
      },
      A2uiRendererService,
    provideMarkdownRenderer(renderMarkdown as any),
    {
      provide: IMAGE_CONFIG,
      useValue: {
        disableImageSizeWarning: true,
        disableImageLazyLoadWarning: true,
      },
    },
    ]
  }).catch(err => {
    console.log("00000000000000000000");
    console.error('Angular 应用初始化失败：', err);
    throw err; // 可选：让调用者能捕获错误
  });
}