import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AstTreeComponent } from './ast-tree.component';

describe('AstTreeComponent', () => {
  let component: AstTreeComponent;
  let fixture: ComponentFixture<AstTreeComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
    imports: [AstTreeComponent]
})
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(AstTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
