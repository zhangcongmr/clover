import { Header } from '@/app/components/Header';
import { HeroSection } from '@/app/components/HeroSection';
import { FeaturesSection } from '@/app/components/FeaturesSection';
import { IntegrationSection } from '@/app/components/IntegrationSection';
import { PricingSection } from '@/app/components/PricingSection';
import { PlatformSection } from '@/app/components/PlatformSection';
import { CTASection } from '@/app/components/CTASection';
import { Footer } from '@/app/components/Footer';
import { useEffect, useState } from 'react';

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null?"" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`${baseHref}/api/auth/profile`, {
          credentials: 'include', // 携带 Cookie
        });
        const userData = await response.json();
        // 默认跳转到主页
        window.location.href = '/home/';
      } catch (err) {
        console.error('获取用户信息失败:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <HeroSection />
        <FeaturesSection />
        <IntegrationSection />
        <PricingSection />
        <PlatformSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
