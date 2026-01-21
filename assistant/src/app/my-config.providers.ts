// my-config.providers.ts
import { makeEnvironmentProviders } from '@angular/core';
import { MyConfigService, MyConfig } from './my-config.service';
import { MY_CONFIG } from './tokens';

export function provideMyConfig(config: MyConfig) {
console.log('✅ provideMyConfig called with:', config); // 👈 加这一行
  return makeEnvironmentProviders([
    {
      provide: MY_CONFIG,
      useValue: config
    }
  ]);
}