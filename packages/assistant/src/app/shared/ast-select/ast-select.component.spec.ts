import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstSelectComponent } from './ast-select.component';

describe('AstSelectComponent', () => {
  let component: AstSelectComponent;
  let fixture: ComponentFixture<AstSelectComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstSelectComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstSelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
