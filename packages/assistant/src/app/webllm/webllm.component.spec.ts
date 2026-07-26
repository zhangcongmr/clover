import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WebllmComponent } from './webllm.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('WebllmComponent', () => {
  let component: WebllmComponent;
  let fixture: ComponentFixture<WebllmComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [WebllmComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(WebllmComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
