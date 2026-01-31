/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { AstTableComponent } from './ast-table.component';

describe('AstTableComponent', () => {
  let component: AstTableComponent;
  let fixture: ComponentFixture<AstTableComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [AstTableComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(AstTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
