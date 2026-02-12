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
  textEditorView = viewChild<ElementRef<HTMLButtonElement>>('textEditor');
  @Input() textInfo: any;
  readonly saved = output();

  constructor() { }

  ngOnInit() {

    const textEditorView = this.textEditorView()
    const view = new EditorView({
      parent: textEditorView?.nativeElement,
      doc: `*CodeMirror* Markdown \`mode\``,
      extensions: [basicSetup, markdown(),
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
    if (document) {
      const contentEle = document.getElementById('content_'+ this.textInfo.id);
      if (contentEle) {
        contentEle.innerHTML = marked.parse(this.textInfo.value);
      }
    }
  }


  public saveText(evt: KeyboardEvent) {
    if (evt.code == "KeyS" && (navigator.platform.match("Mac") ? evt.metaKey : evt.ctrlKey)) {
      evt.preventDefault();
      //如果api已经保存了,则不需要再次保存
      // if(this.textInfo['saved']) {
      //   return;
      // }
      this.textInfo['saved'] = true;
      this.saved.emit(this.textInfo);
    }
  }
}
