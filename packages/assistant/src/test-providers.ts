import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MY_CONFIG } from './app/tokens';

const testProviders: (Provider | EnvironmentProviders)[] = [
  provideHttpClientTesting(),
  { provide: MY_CONFIG, useValue: {} }
];

export default testProviders;
