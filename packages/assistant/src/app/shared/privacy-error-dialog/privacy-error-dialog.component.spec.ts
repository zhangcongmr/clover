import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PrivacyErrorDialogComponent } from './privacy-error-dialog.component';
import { describe, it, expect, beforeEach, vi } from "vitest";

describe('PrivacyErrorDialogComponent', () => {
  let component: PrivacyErrorDialogComponent;
  let fixture: ComponentFixture<PrivacyErrorDialogComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [PrivacyErrorDialogComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PrivacyErrorDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
