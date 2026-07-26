import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { TerminalComponent } from './terminal.component';

describe('TerminalComponent', () => {
  let component: TerminalComponent;
  let fixture: ComponentFixture<TerminalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TerminalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TerminalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize terminal on ngOnInit', () => {
    vi.spyOn(component as any, 'initializeTerminal');
    component.ngOnInit();
    expect((component as any).initializeTerminal).toHaveBeenCalled();
  });

  it('should disconnect on ngOnDestroy', () => {
    vi.spyOn(component, 'disconnect');
    component.ngOnDestroy();
    expect(component.disconnect).toHaveBeenCalled();
  });
});