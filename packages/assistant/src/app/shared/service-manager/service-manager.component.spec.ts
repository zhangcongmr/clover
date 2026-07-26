import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ServiceManagerComponent } from './service-manager.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('ServiceManagerComponent', () => {
  let component: ServiceManagerComponent;
  let fixture: ComponentFixture<ServiceManagerComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [ServiceManagerComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ServiceManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
