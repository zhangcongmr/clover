// my-config.providers.ts
import { makeEnvironmentProviders } from '@angular/core';
import { MyConfig } from './my-config.service';
import { MY_CONFIG } from './tokens';

export function provideMyConfig(config: MyConfig) {
  return makeEnvironmentProviders([
    {
      provide: MY_CONFIG,
      useValue: config
    }
  ]);
}