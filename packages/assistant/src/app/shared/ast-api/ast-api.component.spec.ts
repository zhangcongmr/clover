import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstApiComponent } from './ast-api.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('AstApiComponent', () => {
  let component: AstApiComponent;
  let fixture: ComponentFixture<AstApiComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstApiComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstApiComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
