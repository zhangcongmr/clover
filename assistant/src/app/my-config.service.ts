// my-config.service.ts
import { Inject, Injectable } from '@angular/core';
import { MY_CONFIG } from './tokens';

export interface MyConfig {
  apiUrl: string;
  timeout: number;
}

@Injectable({
  providedIn: 'root'
})
export class MyConfigService {
  constructor(@Inject(MY_CONFIG) private config: MyConfig) {}

  getApiUrl(): string {
    return this.config.apiUrl;
  }
}