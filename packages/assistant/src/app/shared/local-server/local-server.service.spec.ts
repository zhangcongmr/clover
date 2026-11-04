import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LocalServerService } from './local-server.service';

const SERVER_URL_KEY = 'assistant_serverUrl';

describe('LocalServerService', () => {
  let service: LocalServerService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(LocalServerService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('serverUrl persistence', () => {
    it('writes the configured address to the storage key', () => {
      service.setServerUrl('http://192.168.1.100:4000');

      expect(localStorage.getItem(SERVER_URL_KEY)).toBe('http://192.168.1.100:4000');
      expect(service.serverUrl).toBe('http://192.168.1.100:4000');
    });

    it('persists across a service re-creation (page reload)', () => {
      service.setServerUrl('http://192.168.1.100:4000');

      // Simulate a reload: a fresh instance reads the stored value back.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const reloaded = TestBed.inject(LocalServerService);

      expect(reloaded.serverUrl).toBe('http://192.168.1.100:4000');
      expect(reloaded.getBaseUrl()).toBe('http://192.168.1.100:4000');
    });

    it('trims surrounding whitespace before storing', () => {
      service.setServerUrl('  http://192.168.1.100:4000  ');

      expect(localStorage.getItem(SERVER_URL_KEY)).toBe('http://192.168.1.100:4000');
      expect(service.getBaseUrl()).toBe('http://192.168.1.100:4000');
    });

    it('clears the stored address when set to an empty value', () => {
      service.setServerUrl('http://192.168.1.100:4000');
      service.setServerUrl('');

      expect(localStorage.getItem(SERVER_URL_KEY)).toBeNull();
      expect(service.serverUrl).toBe('');
      // Falls back to the app origin (same-origin mode).
      expect(service.getBaseUrl()).toBe(window.location.origin);
    });

    it('ignores the pre-rename key (no compatibility layer)', () => {
      // The legacy 'assistant_agentUrl' key is no longer read.
      localStorage.setItem('assistant_agentUrl', 'http://legacy:4000');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(LocalServerService);

      expect(fresh.serverUrl).toBe('');
      expect(fresh.getBaseUrl()).toBe(window.location.origin);
    });
  });
});
