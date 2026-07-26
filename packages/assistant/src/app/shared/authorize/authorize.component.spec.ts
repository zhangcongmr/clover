import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuthorizeComponent } from './authorize.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('AuthorizeComponent', () => {
  let component: AuthorizeComponent;
  let fixture: ComponentFixture<AuthorizeComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AuthorizeComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AuthorizeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
