import { Header } from '@/app/components/Header';
import { HeroSection } from '@/app/components/HeroSection';
import { FeaturesSection } from '@/app/components/FeaturesSection';
import { IntegrationSection } from '@/app/components/IntegrationSection';
import { PricingSection } from '@/app/components/PricingSection';
import { PlatformSection } from '@/app/components/PlatformSection';
import { CTASection } from '@/app/components/CTASection';
import { Footer } from '@/app/components/Footer';

export default function App() {
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
