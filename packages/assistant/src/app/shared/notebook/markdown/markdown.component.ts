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

  constructor() { }

  ngOnInit() {

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
      const doc = this.getEditorContent()
      this.textInfo()['saved'] = true;
      this.textInfo()['content'] = doc;
      this.saved.emit(this.textInfo());
    }
  }

  getEditorContent(): string {
    return this.editorView.state.doc.toString();
  }
}
