import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstTabGroupComponent } from './ast-tab-group.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('AstTabGroupComponent', () => {
  let component: AstTabGroupComponent;
  let fixture: ComponentFixture<AstTabGroupComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstTabGroupComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstTabGroupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
