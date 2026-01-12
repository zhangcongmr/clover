/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { AstSelectComponent } from './ast-select.component';

describe('AstSelectComponent', () => {
  let component: AstSelectComponent;
  let fixture: ComponentFixture<AstSelectComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [AstSelectComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AstSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
