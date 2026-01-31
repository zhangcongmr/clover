/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { ApiComponentComponent } from './user-component.component';

describe('ApiComponentComponent', () => {
  let component: ApiComponentComponent;
  let fixture: ComponentFixture<ApiComponentComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [ApiComponentComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ApiComponentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
