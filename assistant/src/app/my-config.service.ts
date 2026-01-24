// my-config.service.ts
import { Inject, Injectable } from '@angular/core';
import { MY_CONFIG } from './tokens';
import { DocModel } from './shared/model';

export interface MyConfig {
  apiUrl?: string;
  timeout?: number;
  doc?: string | any | (() => string | DocModel);
}

@Injectable({
  providedIn: 'root'
})
export class MyConfigService {
  constructor(@Inject(MY_CONFIG) private config: MyConfig) {}

  getApiUrl(): string | undefined {
    return this.config.apiUrl;
  }

  getTimeout(): number | undefined {
    return this.config.timeout;
  }

  getDoc(): string | any | (() => string | DocModel) | undefined {
    return this.config.doc;
  }

}