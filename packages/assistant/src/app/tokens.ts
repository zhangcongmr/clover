// tokens.ts
import { InjectionToken } from '@angular/core';
import { MyConfig } from './my-config.service';

export const MY_CONFIG = new InjectionToken<MyConfig>('MyConfig');