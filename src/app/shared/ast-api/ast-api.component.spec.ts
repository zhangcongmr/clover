/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { AstApiComponent } from './ast-api.component';

describe('AstApiComponent', () => {
  let component: AstApiComponent;
  let fixture: ComponentFixture<AstApiComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [AstApiComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AstApiComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
