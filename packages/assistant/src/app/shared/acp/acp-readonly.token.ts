import { InjectionToken } from '@angular/core';

/**
 * Marks an `AcpService` instance as a read-only session viewer.
 *
 * The collaboration session detail panel creates its own `AcpService` +
 * `AcpSseService` (component-level `providers`) so it can `session/load` another
 * session without touching the main chat state. Such a shadow instance must not
 * persist anything: no `localStorage` agent selection, no `agent-config.json`
 * and no project/task record writes.
 *
 * Provide it at the detail panel level:
 * `{ provide: ACP_READ_ONLY, useValue: true }`.
 */
export const ACP_READ_ONLY = new InjectionToken<boolean>('ACP_READ_ONLY');
