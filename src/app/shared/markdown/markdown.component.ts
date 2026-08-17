import { Component, Input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

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

  @Input() textInfo: any;
  readonly saved = output();

  constructor() { }

  ngOnInit() {
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
