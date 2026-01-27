import { Header } from "@/app/components/Header";
import { Sidebar } from "@/app/components/Sidebar";
import { EventsFeed } from "@/app/components/EventsFeed";
import { RightSidebar } from "@/app/components/RightSidebar";
import { useEffect, useState } from "react";

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({ baseHref, onAction }: MyReactComponentProps) {
  baseHref = baseHref == null ? "" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`${baseHref}/api/auth/profile`, {
          credentials: 'include', // 携带 Cookie
        });
        const userData = await response.json();
        setUser(userData);
      } catch (err) {
        console.error('获取用户信息失败:', err);
        // 可跳转到登录页
        window.location.href = '/signin';
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  if (loading) return <div>加载中...</div>;
  if (!user) return null;


  return (
    <div className="size-full flex flex-col bg-white">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <EventsFeed />
        <RightSidebar />
      </div>
    </div>
  );
}
