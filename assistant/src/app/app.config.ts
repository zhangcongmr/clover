import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { withInterceptorsFromDi, provideHttpClient } from '@angular/common/http';

import { routes } from './app.routes';
import { provideMyConfig } from './my-config.providers';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { serverRoutes } from './app.routes.server';

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(withInterceptorsFromDi()),provideZonelessChangeDetection(),  provideRouter(routes)]
};

export const serverConfig: ApplicationConfig = {
  providers: [
            provideMyConfig({
              apiUrl: 'https://api.example.com',
              timeout: 5000
            }),
    provideServerRendering(withRoutes(serverRoutes))
  ]
};
