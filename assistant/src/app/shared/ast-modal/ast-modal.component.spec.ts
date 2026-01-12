/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { AstModalComponent } from './ast-modal.component';

describe('AstModalComponent', () => {
  let component: AstModalComponent;
  let fixture: ComponentFixture<AstModalComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [AstModalComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AstModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
