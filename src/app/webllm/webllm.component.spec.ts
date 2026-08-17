/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { WebllmComponent } from './webllm.component';

describe('WebllmComponent', () => {
  let component: WebllmComponent;
  let fixture: ComponentFixture<WebllmComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [WebllmComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(WebllmComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
