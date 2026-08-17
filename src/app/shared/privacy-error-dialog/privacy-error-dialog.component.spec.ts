/* tslint:disable:no-unused-variable */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';

import { PrivacyErrorDialogComponent } from './privacy-error-dialog.component';

describe('PrivacyErrorDialogComponent', () => {
  let component: PrivacyErrorDialogComponent;
  let fixture: ComponentFixture<PrivacyErrorDialogComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
    imports: [PrivacyErrorDialogComponent]
})
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(PrivacyErrorDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
