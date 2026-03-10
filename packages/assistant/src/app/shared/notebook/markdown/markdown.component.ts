import { Component, ElementRef, input, OnInit, output, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {EditorView, basicSetup} from "codemirror"
import {markdown} from "@codemirror/lang-markdown"

@Component({
    selector: 'markdown',
    templateUrl: './markdown.component.html',
    styleUrls: ['./markdown.component.css'],
    host: {
        '[tabIndex]': '-1',
        '(keydown)': 'saveText($event)',
    },
    standalone: true,
    imports: [FormsModule]
})
export class MarkdownComponent implements OnInit {
  textEditorView = viewChild<ElementRef<HTMLElement>>('textEditor');
  textInfo = input<any>();
  readonly saved = output();
  private editorView!: EditorView;
  originalNewlineType!: string;
  constructor() { }

  ngOnInit() {
    // --- 4. 检测原始换行符 ---
    this.originalNewlineType = detectNewlineType(this.textInfo().content);

    const textEditorView = this.textEditorView()
    this.editorView = new EditorView({
      parent: textEditorView?.nativeElement,
      doc: this.textInfo().content,
      extensions: [basicSetup, markdown(), EditorView.lineWrapping, // ✅ 正确用法 启用软换行（soft wrapping）
        EditorView.theme({
          '&': {
            height: '100%',
            minHeight: '0',
            fontFamily: 'Consolas',
            border: 'none', // 移除边框
            outline: 'none', // 可选：移除聚焦时的 outline
            boxShadow: 'none',
          },
          '.cm-scroller': {
            height: '100%',
            overflow: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: '#ccc transparent',
          },
          ".cm-gutters": {
            backgroundColor: "var(--vscode-editor-background)",
            color: "var(--vscode-foreground)",
            border: "none", 
            "&:not(.cm-activeLineGutter)": { // 对非当前行的 gutter 应用样式
              backgroundColor: "var(--vscode-sideBar-background)",
              color: "var(--vscode-foreground)",
            },
          },  
          ".cm-activeLineGutter": { // 当前行在 gutter 上的高亮样式
            backgroundColor: "var(--vscode-editor-background)", // 当前行号所在 gutter 的背景色
            color: "var(--vscode-textLink-activeForeground)", // 当前行号的颜色
          },
          '.cm-cursor': {
            caretColor: "#ff0000", // 改变颜色
            borderLeft: "2px solid currentColor", // 改变粗细
            // borderLeft: "solid transparent", // 甚至设为透明也无法变成中划线
          }
        })
      ]
    })
  }

  outOfText() {
  }


  public saveText(evt: KeyboardEvent) {
    if (evt.code == "KeyS" && (navigator.platform.match("Mac") ? evt.metaKey : evt.ctrlKey)) {
      evt.preventDefault();
      //如果api已经保存了,则不需要再次保存
      // if(this.textInfo['saved']) {
      //   return;
      // }

      const contentWithLF = this.getEditorContent()
      // 将 \n 转换回我们之前检测到的原始格式
      const contentWithOriginalNewlines = convertToOriginalNewlines(contentWithLF, this.originalNewlineType);

      this.textInfo()['saved'] = true;
      this.textInfo()['content'] = contentWithOriginalNewlines;
      this.saved.emit(this.textInfo());
    }
  }

  getEditorContent(): string {
    // 无论输入是什么，toString() 都返回 \n 分隔的字符串
    return this.editorView.state.doc.toString();
  }
}

// --- 1. 只检测，不标准化 ---
function detectNewlineType(text: string): string {
  // 检测原始换行符类型
  if (text.includes('\r\n')) {
    return '\r\n';
  } else if (text.includes('\r')) {
    return '\r';
  }
  // 如果没有找到特殊换行符，默认为 \n
  return '\n';
}

// --- 2. 将内部的 \n 转换回原始格式 ---
function convertToOriginalNewlines(value: string, originalNewline: string): string {
  if (originalNewline === '\r\n') {
    return value.replace(/\n/g, '\r\n');
  } else if (originalNewline === '\r') {
    return value.replace(/\n/g, '\r');
  }
  // 如果原始格式就是 \n，直接返回
  return value;
}
