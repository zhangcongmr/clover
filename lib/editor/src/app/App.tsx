import { useEffect } from 'react';
import { loadAstApp } from 'assistant';

// 防止重复加载
let angularLoaded = false;

export default function App() {

  useEffect(() => {
    if (angularLoaded) return;


    angularLoaded = true;

    loadAstApp("coderEditor")
      .then(start => start({ apiUrl: '...' }))
      .catch(err => {
        console.error('Angular failed to start', err);
        angularLoaded = false; // 可选：允许重试
      });

    return () => {
      // 可选：清理逻辑（通常不需要移除 script）
    };
  }, []);

  return (
    <div>
      {/* <h1>React App</h1> */}
      {/* 使用 Angular Web Component */}
      {/* <app-root style={{ height: '100vh', display: 'block' }}></app-root> */}
      <div id="coderEditor"></div>
      {/* <p>Back to React</p> */}
    </div>
  );
}