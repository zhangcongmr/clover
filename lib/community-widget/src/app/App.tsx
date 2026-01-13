import { Header } from '@/app/components/Header';
import { CategorySidebar } from '@/app/components/CategorySidebar';
import { MainContent } from '@/app/components/MainContent';
import { TrendingProjects } from '@/app/components/TrendingProjects';

export default function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <CategorySidebar />
        <MainContent />
        <TrendingProjects />
      </div>
    </div>
  );
}
