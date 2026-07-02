// my-config.service.ts
import { Inject, Injectable } from '@angular/core';
import { MY_CONFIG } from './tokens';
import { DocModelType } from './shared/model';

export interface MyConfig {
  apiUrl?: string;
  timeout?: number;
  doc?: DocModelType;
  fileName?: string;
  agentUrl?: string;
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

  getDoc(): DocModelType | undefined {
    return this.config.doc;
  }

  getFileName(): string | undefined {
    return this.config.fileName;
  }

  getAgentUrl(): string | undefined {
    return this.config.agentUrl;
  }

}