import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from "react-router";
import { Luxio } from 'luxio';

// 防止重复加载
let angularLoaded = false;

function HomePage() {
  let params = useParams();

  const projectDef = (project: any) => {
    fetch("/user/apiInfoModel/" + project.id).then(
      (response: any) => {
        if (!response.ok) {
          throw new Error('Network response was not ok.');
        }
        return response.json()
      }).then(rawData => {
        Luxio("coderEditor", rawData, rawData?.name)
          .catch(err => {
            console.error('Angular failed to start', err);
            angularLoaded = false; // 可选：允许重试
          });
      });
  }

  useEffect(() => {
    if (angularLoaded) return;

    angularLoaded = true;
    console.log('Loading Angular app with ID:', params);
    if (params && params.id) {
      projectDef({ id: params.id });
    } else {
      Luxio("coderEditor")
        .catch(err => {
          console.error('Angular failed to start', err);
          angularLoaded = false; // 可选：允许重试
        });
    }
  }, []);

  return (
    <div>
      {/* <h1>React App</h1> */}
      {/* 使用 Angular Web Component */}
      {/* <app-root style={{ height: '100vh', display: 'block' }}></app-root> */}
      <div id="coderEditor"></div>
      {/* <p>Back to React</p> */}
      {/* <Example /> */}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 首页 */}
        <Route path="editor" element={<HomePage />} />

        {/* 动态路由：匹配 /view/任意ID */}
        <Route path="editor/:id" element={<HomePage />} />

        {/* 可选：404 页面 */}
        {/* <Route path="*" element={<HomePage />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
