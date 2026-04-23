import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from "react-router";
import { Luxio } from 'luxio';

// 防止重复加载
let angularLoaded = false;

/**
 * 调用后端API实例化Podman容器
 * @param apiInfoModel API模型数据
 */
function createPodmanInstance(apiInfoModel: any): void {
  // First, fetch user profile to get username
  fetch(`/api/auth/profile`, {
    credentials: 'include', // 携带 Cookie
  })
  .then((response) => {
    if (!response.ok) {
      throw new Error('Failed to fetch user profile');
    }
    return response.json();
  })
  .then((userData) => {
    console.log('Creating Podman container instance for user:', userData.username);
    
    if (!userData.username) {
      console.warn('Username not found in user profile, skipping container instantiation');
      return;
    }

    if(userData.username !== apiInfoModel.username) {
      console.warn(`Username in API model (${apiInfoModel.username}) does not match logged-in user (${userData.username}), skipping container instantiation`);
      apiInfoModel.isLocked = true; // 可选：标记模型为锁定状态，前端可据此禁用相关功能
      return;
    }

    // Then create Podman instance
    return fetch(`/user/podman/create-instance?userName=${encodeURIComponent(userData.username)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(apiInfoModel),
    });
  })
  .then((response) => {
    if (!response) {
      // User profile fetch failed or username missing
      return;
    }
    
    if (!response.ok) {
      return response.json().catch(() => ({})).then((errorData) => {
        throw new Error(`Failed to create Podman instance: ${response.status} ${response.statusText}. ${JSON.stringify(errorData)}`);
      });
    }
    return response.json();
  })
  .then((result) => {
    if (!result) {
      return;
    }
    
    console.log('Podman instance creation response:', result);

    if (result.status === 'SUCCESS') {
      console.log('Podman container instance created successfully');
    } else {
      console.warn('Podman container instance creation returned non-success status:', result.message);
    }
  })
  .catch((error) => {
    console.error('Error creating Podman container instance:', error);
    // 不抛出错误，避免影响主流程
  });
}

function ViewPage() {
  let params = useParams();

  const projectDef = (project: any) => {
    fetch("/user/apiInfoModel/" + project.id).then(
      (response: any) => {
        if (!response.ok) {
          throw new Error('Network response was not ok.');
        }
        return response.json()
      }).then(rawData => {
        // 查询模型成功后，调用接口实例化容器
        if (rawData) {
          createPodmanInstance(rawData);
        } else {
          console.warn('API model does not contain username, skipping container instantiation');
        }
        
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
        <Route path="editor" element={<ViewPage />} />

        {/* 动态路由：匹配 /view/任意ID */}
        <Route path="editor/:id" element={<ViewPage />} />

        {/* 可选：404 页面 */}
        {/* <Route path="*" element={<ViewPage />} /> */}
      </Routes>
    </BrowserRouter>
  );
}
