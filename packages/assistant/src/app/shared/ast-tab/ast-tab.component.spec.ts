import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstTabComponent } from './ast-tab.component';

describe('AstTabComponent', () => {
  let component: AstTabComponent;
  let fixture: ComponentFixture<AstTabComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstTabComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
