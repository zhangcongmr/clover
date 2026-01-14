import { Header } from "@/app/components/Header";
import { Sidebar } from "@/app/components/Sidebar";
import { EventsFeed } from "@/app/components/EventsFeed";
import { RightSidebar } from "@/app/components/RightSidebar";

export default function App() {
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
