import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from "react-router";
import { Luxio } from 'luxio';

// 防止重复加载
let angularLoaded = false;


async function fetchProfile() {
  try {
    // First, fetch user profile to get username
    const profileResponse = await fetch(`/api/auth/profile`, {
      credentials: 'include', // 携带 Cookie
    });

    if (!profileResponse.ok) {
      throw new Error('Failed to fetch user profile');
    }

    const userData = await profileResponse.json();
    console.log('Creating Podman container instance for user:', userData.username);

    return userData

  } catch (error) {
    console.error('Error creating Podman container instance:', error);
    // 不抛出错误，避免影响主流程
  }
}

function processInstanceContainer(userData: any, apiInfoModel: any) {
  // Then create Podman instance
  return fetch(`/user/podman/create-instance?userName=${encodeURIComponent(userData.username)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(apiInfoModel),
  })
  .then((createResponse) => {
    if (!createResponse.ok) {
      return createResponse.json().catch(() => ({})).then((errorData) => {
        throw new Error(`Failed to create Podman instance: ${createResponse.status} ${createResponse.statusText}. ${JSON.stringify(errorData)}`);
      });
    }
    return createResponse.json();
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
  });
}

async function afterQueryApiModel(rawData: any): Promise<void> {
  const userData = await fetchProfile();
  if (userData.username !== rawData.username) {
    console.warn(`Username in API model (${rawData.username}) does not match logged-in user (${userData.username}), skipping container instantiation`);
    rawData.isLocked = true; // 可选：标记模型为锁定状态，前端可据此禁用相关功能
  } else {
    processInstanceContainer(userData, rawData);
  }

  Luxio("coderEditor", rawData, rawData?.name)
    .catch(err => {
      console.error('Angular failed to start', err);
      angularLoaded = false;
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
      }).then( (rawData: any) => {
        // 查询模型成功后，调用接口实例化容器
        afterQueryApiModel(rawData);
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
