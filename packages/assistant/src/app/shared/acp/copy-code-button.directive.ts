import { Directive, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';

const COPY_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
</svg>
`;

@Directive({
  selector: '[appCopyCodeButton]',
  standalone: true
})
export class CopyCodeButtonDirective implements AfterViewInit, OnDestroy {
  private observer: MutationObserver | null = null;

  constructor(private el: ElementRef) {}

  ngAfterViewInit(): void {
    this.addCopyButtons();
    this.observeChanges();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private observeChanges(): void {
    this.observer = new MutationObserver(() => {
      this.addCopyButtons();
    });

    this.observer.observe(this.el.nativeElement, {
      childList: true,
      subtree: true
    });
  }

  private addCopyButtons(): void {
    const codeBlocks = this.el.nativeElement.querySelectorAll('pre:not([data-copy-added])');

    codeBlocks.forEach((pre: HTMLElement) => {
      pre.setAttribute('data-copy-added', 'true');

      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.innerHTML = `${COPY_ICON_SVG}<span>Copy</span>`;
      btn.type = 'button';

      btn.addEventListener('click', () => {
        this.copyCode(pre, btn);
      });

      pre.appendChild(btn);
    });
  }

  private async copyCode(pre: HTMLElement, btn: HTMLElement): Promise<void> {
    const code = pre.querySelector('code');
    const text = code?.textContent || pre.textContent || '';

    try {
      await navigator.clipboard.writeText(text);
      const span = btn.querySelector('span');
      if (span) {
        span.textContent = 'Copied!';
        setTimeout(() => {
          span.textContent = 'Copy';
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
}
