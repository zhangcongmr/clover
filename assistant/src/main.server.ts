import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig, serverConfig } from './app/app.config';
import { mergeApplicationConfig } from '@angular/core';

const bootstrap = (context: BootstrapContext) =>
    bootstrapApplication(AppComponent, mergeApplicationConfig(appConfig, serverConfig), context);

export default bootstrap;
