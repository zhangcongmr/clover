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

  describe('serverEpoch', () => {
    it('advances when the target server changes', () => {
      const before = service.serverEpoch();

      service.setServerUrl('http://192.168.1.100:4000');

      expect(service.serverEpoch()).toBe(before + 1);
    });

    it('advances when switching back to the same-origin server', () => {
      service.setServerUrl('http://192.168.1.100:4000');
      const before = service.serverEpoch();

      service.setServerUrl('');

      expect(service.serverEpoch()).toBe(before + 1);
    });

    it('does not advance when the address is unchanged', () => {
      service.setServerUrl('http://192.168.1.100:4000');
      const before = service.serverEpoch();

      // Re-saving the same address (e.g. the Settings page Save button) must
      // not make server-bound connections re-open for no reason.
      service.setServerUrl('http://192.168.1.100:4000');

      expect(service.serverEpoch()).toBe(before);
    });

    it('does not advance for a whitespace-only difference', () => {
      service.setServerUrl('http://192.168.1.100:4000');
      const before = service.serverEpoch();

      service.setServerUrl('  http://192.168.1.100:4000  ');

      expect(service.serverEpoch()).toBe(before);
    });
  });

  describe('serverUrlHistory', () => {
    it('starts empty', () => {
      expect(service.serverUrlHistory()).toEqual([]);
    });

    it('records an address, most recent first', () => {
      service.addToHistory('http://a:4000');
      service.addToHistory('http://b:4000');

      expect(service.serverUrlHistory()).toEqual(['http://b:4000', 'http://a:4000']);
    });

    it('moves a known address to the front instead of duplicating it', () => {
      service.addToHistory('http://a:4000');
      service.addToHistory('http://b:4000');
      service.addToHistory('http://a:4000');

      expect(service.serverUrlHistory()).toEqual(['http://a:4000', 'http://b:4000']);
    });

    it('ignores an empty address', () => {
      service.addToHistory('   ');

      expect(service.serverUrlHistory()).toEqual([]);
    });

    it('trims the address before recording it', () => {
      service.addToHistory('  http://a:4000  ');

      expect(service.serverUrlHistory()).toEqual(['http://a:4000']);
    });

    it('removes a single entry', () => {
      service.addToHistory('http://a:4000');
      service.addToHistory('http://b:4000');

      service.removeFromHistory('http://a:4000');

      expect(service.serverUrlHistory()).toEqual(['http://b:4000']);
    });

    it('persists across a service re-creation (page reload)', () => {
      service.addToHistory('http://a:4000');
      service.addToHistory('http://b:4000');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const reloaded = TestBed.inject(LocalServerService);

      expect(reloaded.serverUrlHistory()).toEqual(['http://b:4000', 'http://a:4000']);
    });

    it('keeps every address, without an upper bound', () => {
      for (let i = 0; i < 12; i++) {
        service.addToHistory(`http://host-${i}:4000`);
      }

      const history = service.serverUrlHistory();
      expect(history.length).toBe(12);
      // The newest one is first, the oldest is still there.
      expect(history[0]).toBe('http://host-11:4000');
      expect(history).toContain('http://host-0:4000');
    });

    it('ignores a corrupt stored entry', () => {
      localStorage.setItem('assistant_serverUrlHistory', 'not json');

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const fresh = TestBed.inject(LocalServerService);

      expect(fresh.serverUrlHistory()).toEqual([]);
    });
  });
});
