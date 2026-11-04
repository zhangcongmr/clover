import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal } from '@angular/core';

import { SettingsComponent } from './settings.component';
import { LocalServerService } from '../../shared/local-server/local-server.service';

const SERVER_URL_KEY = 'assistant_serverUrl';

/**
 * The Server URL input must not be a two-way binding to
 * `localServerService.serverUrl`: typing has to leave the running server
 * alone. Only "Save" may commit the address.
 */
describe('SettingsComponent — Server URL input', () => {
  let component: SettingsComponent;
  let localServerService: LocalServerService;

  beforeEach(async () => {
    localStorage.clear();

    // The component pulls in a fair amount of services; stub the ones that
    // would otherwise reach the network on construction.
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        {
          provide: LocalServerService,
          useValue: {
            serverUrl: '',
            serverEpoch: signal(0),
            serverUrlHistory: signal<string[]>([]),
            getBaseUrl: () => 'http://localhost:4200',
            setServerUrl: vi.fn(function (this: { serverUrl: string }, url: string) {
              this.serverUrl = url;
            }),
            disconnect: vi.fn(),
            checkServerAvailable: vi.fn(async () => true),
            addToHistory: vi.fn(),
            removeFromHistory: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    localServerService = TestBed.inject(LocalServerService);

    const fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not touch the service when the user types', () => {
    component.onServerUrlInput('http://192.168.1.50:4000');

    expect(component.serverUrlInput()).toBe('http://192.168.1.50:4000');
    // The service must be untouched: the app keeps talking to the old server.
    expect(localServerService.serverUrl).toBe('');
  });

  it('commits the typed address to the service only on connect', async () => {
    component.onServerUrlInput('http://192.168.1.50:4000');
    await component.connect();

    expect(localServerService.setServerUrl).toHaveBeenCalledWith('http://192.168.1.50:4000');
  });

  it('does not call setServerUrl while typing', () => {
    component.onServerUrlInput('http://192.168.1.50:4000');

    expect(localServerService.setServerUrl).not.toHaveBeenCalled();
  });

  it('trims the address before committing it', async () => {
    component.onServerUrlInput('  http://192.168.1.50:4000  ');
    await component.connect();

    expect(localServerService.setServerUrl).toHaveBeenCalledWith('http://192.168.1.50:4000');
  });

  it('persists the committed address to localStorage', async () => {
    // Use the real service so the persistence path is exercised.
    TestBed.resetTestingModule();
    localStorage.clear();
    const real = new LocalServerService();
    real.setServerUrl('http://192.168.1.50:4000');

    expect(localStorage.getItem(SERVER_URL_KEY)).toBe('http://192.168.1.50:4000');
  });
});
