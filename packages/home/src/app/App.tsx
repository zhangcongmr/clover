import { useEffect, useState } from "react";
import { EventsFeed } from "@/app/components/EventsFeed";
import { Header } from "@/app/components/Header";
import { Repositories } from "@/app/components/Repositories";
import { RightSidebar } from "@/app/components/RightSidebar";
import { Sidebar } from "@/app/components/Sidebar";


interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({ baseHref, onAction }: MyReactComponentProps) {
  baseHref = baseHref == null ? "" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  const isSignInPage = window.location.pathname === '/signin';

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!isSignInPage);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState<"dashboard" | "repositories">("dashboard");

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
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include' // 确保发送 Cookie
      });
      const data = await response.json();
      if(response.ok) {
        setIsAuthenticated(false);
        // Clear any stored user data
        localStorage.clear();
        sessionStorage.clear();

        // 清除前端状态（如 Zustand / Redux / Context）
        // clearAuthState();
        window.location.href = '/official-site';
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  useEffect(() => {
    // 如果是 /signin 路径，直接停止认证逻辑
    if (isSignInPage) {
      return;
    }

    const fetchProfile = async () => {
      try {
        const response = await fetch(`${baseHref}/api/auth/profile`, {
          credentials: 'include', // 携带 Cookie
        });
        const userData = await response.json();
        setUser(userData);
        setIsAuthenticated(true);
      } catch (err) {
        console.error('获取用户信息失败:', err);
        // 可跳转到登录页
        window.location.href = '/signin';
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [isSignInPage]);

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
    <div className="size-full flex flex-col bg-white">
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
