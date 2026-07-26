import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExplorerComponent } from './explorer.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('ExplorerComponent', () => {
  let component: ExplorerComponent;
  let fixture: ComponentFixture<ExplorerComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [ExplorerComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(ExplorerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
