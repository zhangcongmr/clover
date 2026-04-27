import { useEffect, useState } from "react";
import { EventsFeed } from "@/app/components/EventsFeed";
import { Header } from "@/app/components/Header";
import { Repositories } from "@/app/components/Repositories";
import { RightSidebar } from "@/app/components/RightSidebar";
import { Sidebar } from "@/app/components/Sidebar";
import { authStore } from "@luxio/common";


interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({ baseHref, onAction }: MyReactComponentProps) {
  baseHref = baseHref == null ? "" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  const isSignInPage = window.location.pathname === '/signin';

  // 使用 authStore 的状态（自动初始化，无需手动调用 /api/auth/profile）
  const [state, setState] = useState(authStore.getState());
  const { user, isAuthenticated, loading } = state;

  const [currentView, setCurrentView] = useState<"dashboard" | "repositories">("dashboard");

  // 订阅 authStore 状态变化
  useEffect(() => {
    const unsubscribe = authStore.subscribe(setState);
    return unsubscribe;
  }, []);

  const handleNavigateToRepositories = () => {
    setCurrentView("repositories");
  };

  const handleNavigateToDashboard = () => {
    setCurrentView("dashboard");
  };

  const handleLogin = () => {
    // 默认保存当前页面路径（去掉域名）
    const from = "/home";
    // 存入 sessionStorage（关闭标签页失效，比 localStorage 更安全）
    sessionStorage.setItem('redirect_after_login', from);

    // 跳转到登录页
    window.location.href = '/signin';
  };

  const handleLogout = async () => {
    try {
      // Use the shared authStore which handles both server and client cleanup
      await authStore.logout();
      window.location.href = '/official-site';
    } catch (error) {
      console.error('Logout failed:', error);
      // Still redirect even if logout fails
      window.location.href = '/official-site';
    }
  };

  // 监听认证状态变化，处理未认证情况
  useEffect(() => {
    if (!loading && !isAuthenticated && !isSignInPage) {
      // AuthStore 已自动验证会话，如果未认证则跳转登录
      window.location.href = '/signin';
    }
  }, [loading, isAuthenticated, isSignInPage]);

  // 如果是登录页，显示提示
  if (isSignInPage) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Please login</h2>
        <p>The login service is temporarily unavailable. Please contact the administrator.</p>
        {/* 或放一个静态表单（提交到后端） */}
      </div>
    );
  }

  if (loading) return <div>加载中...</div>;
  if (!user) return null;


  return (
    <div className="h-screen size-full flex flex-col bg-white">
      <Header 
        isAuthenticated={isAuthenticated} 
        onLogin={handleLogin}
        onLogout={handleLogout}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar 
          onNavigateToRepositories={handleNavigateToRepositories}
          onNavigateToDashboard={handleNavigateToDashboard}
          currentView={currentView}
        />
        {currentView === "dashboard" ? (
          <>
            <EventsFeed />
            {/* <RightSidebar /> */}
          </>
        ) : (
          <Repositories />
        )}
      </div>
    </div>
  );
}
