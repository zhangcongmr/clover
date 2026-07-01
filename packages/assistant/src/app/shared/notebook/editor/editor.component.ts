import { Component, ElementRef, input, OnInit, output, viewChild, signal, ViewChild, TemplateRef, ViewContainerRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {EditorView, basicSetup} from "codemirror"
import {markdown} from "@codemirror/lang-markdown"
import {html} from "@codemirror/lang-html"
import {css} from "@codemirror/lang-css"
import {cpp} from "@codemirror/lang-cpp"
import {go} from "@codemirror/lang-go"
import {java} from "@codemirror/lang-java"
import {javascript} from "@codemirror/lang-javascript"
import {json} from "@codemirror/lang-json"
import {python} from "@codemirror/lang-python"
import {sql} from "@codemirror/lang-sql"
import {yaml} from "@codemirror/lang-yaml"
import { rust } from "@codemirror/lang-rust"
import { marked } from 'marked';

@Component({
    selector: 'ast-editor',
    templateUrl: './editor.component.html',
    styleUrls: ['./editor.component.css'],
    host: {
        '[tabIndex]': '-1',
        '(keydown)': 'saveText($event)',
    },
    standalone: true,
    imports: [FormsModule]
})
export class EditorComponent implements OnInit, AfterViewInit {
  textEditorView = viewChild<ElementRef<HTMLElement>>('textEditor');
  textInfo = input<any>();
  readonly saved = output();
  private editorView!: EditorView;
  originalNewlineType!: string;
  
  showToolbar = signal(false);
  // 添加预览相关属性
  isPreviewMode = signal(false);
  previewContent = signal('');
  
  @ViewChild('previewContainer', { static: false }) previewContainer!: ElementRef<HTMLDivElement>;
  
  constructor(private viewContainerRef: ViewContainerRef) {}
  
  ngAfterViewInit() {
    // 初始化预览内容
    this.getEditorContentAndUpdatePreview()
  }

  ngOnInit() {
    const parser = this.getParser();
    // --- 4. 检测原始换行符 ---
    this.originalNewlineType = detectNewlineType(this.textInfo().content);

    const textEditorView = this.textEditorView()
    this.editorView = new EditorView({
      parent: textEditorView?.nativeElement,
      doc: this.textInfo().content,
      extensions: [basicSetup, parser, EditorView.lineWrapping, // ✅ 正确用法 启用软换行（soft wrapping）
        EditorView.theme({
          '&': {
            height: '100%',
            minHeight: '0',
            fontFamily: 'Consolas',
            border: 'none', // 移除边框
            outline: 'none', // 可选：移除聚焦时的 outline
            boxShadow: 'none',
            background: 'var(--vscode-editor-bg-gradient, none) var(--vscode-editor-background)',
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
            border: "none"
          },  
          ".cm-selectionBackground": {
            backgroundColor: "var(--vscode-text-selectionBackground) !important",
          },
          ".cm-activeLineGutter": { // 当前行在 gutter 上的高亮样式
            backgroundColor: "var(--vscode-sideBar-background)", // 当前行号所在 gutter 的背景色
            color: "var(--vscode-textLink-activeForeground)", // 当前行号的颜色
          },
          '.cm-cursor': {
            caretColor: "#ff0000",
            borderLeft: "2px solid currentColor",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
            backgroundColor: "var(--vscode-editor-selectionBackground, #add6ff) !important",
          }
        }),
        EditorView.updateListener.of((update) => {
          if(update.docChanged) {
            this.getEditorContentAndUpdatePreview()
          }
        })
      ]
    })
    
    // 初始化预览内容
    this.getEditorContentAndUpdatePreview()
    // this.updatePreviewContent();
  }

  private getParser() {
    const langType = this.textInfo().label.substring(this.textInfo().label.lastIndexOf('.') + 1);
    switch (langType) {
      case 'md':
        this.showToolbar.set(true);
        return markdown();
      case 'py':
      case 'pyc':
        return python();
      case 'rs':
        return rust();
      case 'sql':
        return sql();
      case 'yaml':
        return yaml();
      case 'c++':
      case 'cpp':
        return cpp();
      case 'html':
        return html();
      case 'java':
        return java();
      case 'js':
        return javascript();
      case 'ts':
        return javascript({ typescript: true });
      case 'jsx':
        return javascript({ jsx: true });
      case 'css':
        return css();
      case 'json':
        return json();
      case 'go':
        return go();
      default:
        return html();
    }
  }

  // 切换编辑/预览模式
  togglePreviewMode() {
    this.isPreviewMode.update(prev => !prev);
    if (this.isPreviewMode()) {
      setTimeout(() => {
        this.updatePreviewContent();
      });
    }
  }

  // 创建Shadow DOM
  private createShadowDOM() {
    if (!this.previewContainer) return;

    // 清除之前的shadow DOM
    const container = this.previewContainer.nativeElement;
    container.innerHTML = ''; // 清除内容
    
    // 创建shadow root
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // 添加基本样式
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
        line-height: 1.6;
        color: var(--vscode-foreground, #616161);
        background: var(--vscode-editor-bg-gradient, none) var(--vscode-editor-background, #ffffff);
      }
      
      h1, h2, h3, h4, h5, h6 {
        margin: 0.83em 0;
        font-weight: bold;
      }
      
      h1 {
        font-size: 2em;
        margin: 0.67em 0;
      }
      
      h2 {
        font-size: 1.5em;
        margin: 0.83em 0;
      }
      
      h3 {
        font-size: 1.17em;
        margin: 1em 0;
      }
      
      h4 {
        font-size: 1em;
        margin: 1.33em 0;
      }
      
      h5 {
        font-size: 0.83em;
        margin: 1.67em 0;
      }
      
      h6 {
        font-size: 0.67em;
        margin: 2.33em 0;
      }
      
      p {
        margin: 1em 0;
      }
      
      ul, ol {
        margin: 1em 0;
        padding-left: 2em;
      }
      
      li {
        margin: 0.5em 0;
      }
      
      pre {
        background-color: var(--vscode-sideBar-background, #f8f8f8);
        border: 1px solid var(--vscode-editorGroup-border, #e7e7e7);
        padding: 12px 15px;
        border-radius: 4px;
        overflow-x: auto;
        color: var(--vscode-foreground, #616161);
        font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
      }
      
      code {
        font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
        background-color: var(--vscode-sideBar-background, #f8f8f8);
        color: var(--vscode-foreground, #616161);
        padding: 2px 4px;
        border-radius: 3px;
        font-size: 0.875em;
      }
      
      blockquote {
        border-left: 4px solid var(--vscode-editorGroup-border, #e7e7e7);
        padding-left: 16px;
        margin-left: 0;
        color: var(--vscode-foreground, #616161);
        background-color: var(--vscode-tab-inactiveBackground, #eef0f2);
      }
      
      a {
        color: var(--vscode-textLink-foreground, #006ab1);
        text-decoration: underline;
      }
      
      a:hover {
        color: var(--vscode-textLink-activeForeground, #006ab1);
      }
      
      table {
        border-collapse: collapse;
        width: 100%;
        margin: 1em 0;
        background-color: var(--vscode-editor-background, #ffffff);
      }
      
      th, td {
        border: 1px solid var(--vscode-editorGroup-border, #e7e7e7);
        padding: 8px 12px;
        color: var(--vscode-foreground, #616161);
      }
      
      th {
        background-color: var(--vscode-tab-inactiveBackground, #eef0f2);
        font-weight: bold;
      }
      
      img {
        max-width: 100%;
        height: auto;
      }
      
      hr {
        height: 1px;
        border: 0;
        background-color: var(--vscode-editorGroup-border, #e7e7e7);
        margin: 20px 0;
      }
    `;
    
    shadowRoot.appendChild(style);
    
    // 添加预览内容
    const contentDiv = document.createElement('div');
    contentDiv.innerHTML = this.previewContent();
    shadowRoot.appendChild(contentDiv);
  }

  // 更新预览内容
  async updatePreviewContent() {
    try {
      const content = this.getEditorContent();
      const parsedContent = await marked.parse(content || '');
      this.previewContent.set(parsedContent || '');
      
      // 如果当前处于预览模式，更新shadow dom
      if (this.isPreviewMode() && this.previewContainer) {
        this.createShadowDOM();
      }
    } catch (error) {
      console.error('Error parsing markdown:', error);
      this.previewContent.set('Error rendering markdown');
    }
  }

  // 获取编辑器内容并更新预览
  getEditorContentAndUpdatePreview() {
    const content = this.getEditorContent();
    if (this.isPreviewMode()) {
      this.updatePreviewContent();
    }
    return content;
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

      const contentWithLF = this.getEditorContentAndUpdatePreview();
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