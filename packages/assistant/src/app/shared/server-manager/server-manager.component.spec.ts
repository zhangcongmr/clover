import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServerManagerComponent } from './server-manager.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('ServerManagerComponent', () => {
  let component: ServerManagerComponent;
  let fixture: ComponentFixture<ServerManagerComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [ServerManagerComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ServerManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
