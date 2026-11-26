import { Routes } from '@angular/router';
import { AppComponent } from './app.component';

export const routes: Routes = [
  // The app is bootstrapped as the root component and does not render a
  // <router-outlet>; these routes exist so the router and the SSR server routes
  // accept every URL, including deep links such as /clover/123.
  { path: '', component: AppComponent },
  { path: 'clover/:id', component: AppComponent },
];
