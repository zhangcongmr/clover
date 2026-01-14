import { Header } from '@/app/components/Header';
import { HeroSection } from '@/app/components/HeroSection';
import { FeaturesSection } from '@/app/components/FeaturesSection';
import { IntegrationSection } from '@/app/components/IntegrationSection';
import { PricingSection } from '@/app/components/PricingSection';
import { PlatformSection } from '@/app/components/PlatformSection';
import { CTASection } from '@/app/components/CTASection';
import { Footer } from '@/app/components/Footer';

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null?"" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

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
