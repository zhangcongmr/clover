import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // The root document is pre-rendered at build time, which is also what produces
    // browser/index.html for the extension build.
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    // Deep links such as /clover/123 are only known at runtime. Render them on the
    // client: the server returns the CSR shell and the Angular router takes over.
    path: '**',
    renderMode: RenderMode.Client
  }
];
