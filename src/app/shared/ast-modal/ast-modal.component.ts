import { AfterViewInit, Component, ElementRef, OnChanges, OnInit, SimpleChanges, ViewEncapsulation, afterNextRender, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'ast-modal',
  templateUrl: './ast-modal.component.html',
  styleUrls: ['./ast-modal.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true
})
export class AstModalComponent implements OnInit, OnChanges, AfterViewInit {
  visible = input(false);
  readonly title = input("");
  readonly close = output<any>();
  modalRef = viewChild<ElementRef>('modal');
  readonly visibleChange = output<any>();

  elementId = "";

  constructor() {
    afterNextRender(() => {
      let me = this;
      // 可选：添加键盘支持（按 ESC 关闭）
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && me.visible()) {
          me.closeDlg();
        }
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["visible"]) {
      if (this.visible() == true) {
        // 等待 Angular 渲染输入框后聚焦
        setTimeout(() => {
          const modalRef = this.modalRef();
          if(modalRef) {
            this.centerInViewport(modalRef.nativeElement)
          }
        }, 0);
      }
      this.visibleChange.emit(this.visible())
    }
  }

  ngOnInit() {
    this.elementId = this.uuid();
  }

  ngAfterViewInit(): void {
  }

  centerInViewport(element: any) {
    const w = element.offsetWidth;
    const h = element.offsetHeight;
    element.style.top = ((window.innerHeight - h) / 2) + 'px';
    element.style.left = ((window.innerWidth - w) / 2) + 'px';
  }

  closeDlg() {
    this.close.emit('c');
  }

  // 拖动功能实现
  dragHandle: any;
  dialogContainer: any;
  isDragging = false;
  offsetX = 0;
  offsetY = 0;

  startDrag(e: any) {
    this.dragHandle = e.currentTarget;
    this.dialogContainer = this.dragHandle.parentElement.parentElement;

    this.isDragging = true;
    // 计算鼠标相对于对话框左上角的偏移
    const dialogRect = this.dialogContainer.getBoundingClientRect();
    this.offsetX = e.clientX - dialogRect.left;
    this.offsetY = e.clientY - dialogRect.top;
    // 添加全局事件监听，防止鼠标移出对话框时失去控制
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    // 防止文本选中
    this.dragHandle.style.userSelect = 'none';
  }

  // 鼠标移动时更新对话框位置
  onMouseMove(e: any) {
    // const dragHandle = e.currentTarget;
    // const dialogContainer = dragHandle.parentElement.parentElement;
    if (!this.isDragging) return;

    // 计算新的位置
    const newX = e.clientX - this.offsetX;
    const newY = e.clientY - this.offsetY;

    // 设置新位置
    this.dialogContainer.style.left = `${newX}px`;
    this.dialogContainer.style.top = `${newY}px`;
    // 移除 transform，因为我们现在用 left/top 定位
    this.dialogContainer.style.transform = 'none';
  }

  // 鼠标松开结束拖动
  onMouseUp(e: any) {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    this.dragHandle.style.userSelect = '';
    this.isDragging = false;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  private uuid(): string {
    let s: Array<any> = [];
    const hexDigits = "0123456789abcdef";
    for (let i = 0; i < 28; i++) {
      const start = Math.floor(Math.random() * 0x10);
      s[i] = hexDigits.substring(start, start + 1);
    }
    s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
    const start1 = (s[19] & 0x3) | 0x8;
    s[19] = hexDigits.substring(start1, start1 + 1); // bits 6-7 of the clock_seq_hi_and_reserved to 01
    s[8] = s[13] = s[18] = s[23] = "-";
    s[0] = "a";

    var uuid = s.join("");
    return uuid;
  }
}
