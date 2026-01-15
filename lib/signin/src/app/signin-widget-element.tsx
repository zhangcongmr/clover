import { createRoot, Root } from 'react-dom/client';
import App from './App';
// 👇 关键：以字符串形式导入 CSS
import cssText from '../styles/index.css?inline'; // Vite 特有语法


class ReactWidgetElement extends HTMLElement {
  private root: Root | null = null;
  private _shadow;
  private dispatchEventFromReact;

  constructor() {
    super();
    // 创建 Shadow DOM
    this._shadow = this.attachShadow({ mode: 'open' });

    // 提供给 React 的事件派发方法
    this.dispatchEventFromReact = (event: any) => {
      this.dispatchEvent(event); // 从 host 元素派发，确保 composed 生效
    };
  }
  static get observedAttributes() {
    return ['base-href']; // 声明需要监听的属性
  }

  attributeChangedCallback(name: any, oldValue: any, newValue: any) {
    if (oldValue !== newValue) {
      const props: any =  {
        onAction: (data: any) => {
          const event = new CustomEvent('widgetAction', {
            detail: data,
            bubbles: true,
            composed: true
          });
          this.dispatchEvent(event);
        }
      };
      props[name.replace(/-(\w)/g, (_: any, c: any) => c.toUpperCase())] = newValue;
      this.renderReactComponent(props);
    }
  }

  connectedCallback() {
    const props: any =  {
      onAction: (data: any) => {
        const event = new CustomEvent('widgetAction', {
          detail: data,
          bubbles: true,
          composed: true
        });
        this.dispatchEvent(event);
      }
    };
    // 初始读取所有属性
    ['base-href'].forEach(prop => {
      const attrName = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
      if (this.hasAttribute(attrName)) {
        props[prop] = this.getAttribute(attrName);
      }
    });

    // 👇 创建 <style> 并注入 CSS
    const style = document.createElement('style');
    style.textContent = cssText;
    this._shadow.appendChild(style);

    this.root = createRoot(this._shadow);
    this.renderReactComponent(props);
  }

  renderReactComponent(props: any) {
    if(this.root) {
      this.root.render(<App {...props} />);
    }
  }

  disconnectedCallback() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}

// 确保只注册一次
if (!customElements.get('signin-widget')) {
  customElements.define('signin-widget', ReactWidgetElement);
}