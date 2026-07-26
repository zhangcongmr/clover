import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstTableComponent } from './ast-table.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('AstTableComponent', () => {
  let component: AstTableComponent;
  let fixture: ComponentFixture<AstTableComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstTableComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
