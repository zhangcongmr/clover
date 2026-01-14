import { Header } from "@/app/components/Header";
import { Sidebar } from "@/app/components/Sidebar";
import { EventsFeed } from "@/app/components/EventsFeed";
import { RightSidebar } from "@/app/components/RightSidebar";

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null?"" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

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
