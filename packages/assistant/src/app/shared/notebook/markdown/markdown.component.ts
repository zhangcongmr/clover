import { Component, ElementRef, Input, OnInit, output, viewChild } from '@angular/core';
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
  @Input() textInfo: any;
  readonly saved = output();
  private editorView!: EditorView;

  constructor() { }

  ngOnInit() {

    const textEditorView = this.textEditorView()
    this.editorView = new EditorView({
      parent: textEditorView?.nativeElement,
      doc: this.textInfo.content,
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
      this.textInfo['saved'] = true;
      this.textInfo['content'] = doc;
      this.saved.emit(this.textInfo);
    }
  }

  getEditorContent(): string {
    return this.editorView.state.doc.toString();
  }
}
