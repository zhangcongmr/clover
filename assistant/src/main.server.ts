import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { serverRoutes } from './app/app.routes.server';
import { provideMyConfig } from './app/my-config.providers';

const serverConfig: ApplicationConfig = {
    providers: [
        provideMyConfig({
            apiUrl: 'https://api.example.com',
            timeout: 5000
        }),
        provideHttpClient(withInterceptorsFromDi()),
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideServerRendering(withRoutes(serverRoutes))
    ]
};

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(AppComponent, serverConfig, context);

export default bootstrap;
