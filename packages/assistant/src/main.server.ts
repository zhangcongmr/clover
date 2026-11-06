import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import { ApplicationConfig, DOCUMENT, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { BootstrapContext, bootstrapApplication, provideClientHydration } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { serverRoutes } from './app/app.routes.server';
import { provideMyConfig } from './app/my-config.providers';
import { injectSvgSprite } from './svg-sprite.const';
import { A2UI_RENDERER_CONFIG, A2uiRendererService, BasicCatalog } from '@a2ui/angular/v0_9';

const serverConfig: ApplicationConfig = {
    providers: [
        // Render the SVG sprite into the SSR/prerendered HTML, so `<use href="#icon-*">`
        // resolves on first paint instead of waiting for the client bundle to inject it.
        provideAppInitializer(() => {
            injectSvgSprite(inject(DOCUMENT));
        }),
        provideMyConfig({
            apiUrl: 'https://api.example.com',
            timeout: 5000
        }),
        provideClientHydration(),
        provideHttpClient(withFetch(), withInterceptorsFromDi()),
        provideZonelessChangeDetection(),
        provideRouter(routes),
        provideServerRendering(withRoutes(serverRoutes)),
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
    ]
};

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(AppComponent, serverConfig, context);

export default bootstrap;
