import { Header } from '@/app/components/Header';
import { CategorySidebar } from '@/app/components/CategorySidebar';
import { MainContent } from '@/app/components/MainContent';
import { TrendingProjects } from '@/app/components/TrendingProjects';

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null?"" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <CategorySidebar />
        <MainContent onAction={onAction} />
        {/* <TrendingProjects /> */}
      </div>
    </div>
  );
}
