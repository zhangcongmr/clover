/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { ServiceManagerComponent } from './service-manager.component';

describe('ServiceManagerComponent', () => {
  let component: ServiceManagerComponent;
  let fixture: ComponentFixture<ServiceManagerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [ServiceManagerComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ServiceManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
