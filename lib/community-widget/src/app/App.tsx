import { Header } from '@/app/components/Header';
import { CategorySidebar } from '@/app/components/CategorySidebar';
import { MainContent } from '@/app/components/MainContent';
import { TrendingProjects } from '@/app/components/TrendingProjects';
import { coreService } from './core.service';
import { useEffect, useState } from 'react';

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null?"" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  let data: any = [];
  const [rawSpecDef, setRawSpecDef] = useState({});
  const [rawSpecBriefDefs, setRawSpecBriefDefs] = useState([]);

   // ✅ 将 fetch 放入 useEffect
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("https://127.0.0.1:8980/user/allBriefs");
        if (!response.ok) {
          throw new Error('Network response was not ok.');
        }
        const rawData = await response.json();
        if (rawData) {
          setRawSpecBriefDefs(rawData);
        }
      } catch (error) {
        console.error('Fetch error:', error);
      }
    };

    fetchData();
  }, []); // 👈 空依赖数组：只在组件挂载时执行一次


  const importFromApiDef = (rawSpecBrief: any) => {
    fetch("https://127.0.0.1:8980/user/apiInfoModel/" + rawSpecBrief.id).then(
      (response: any) => {
        if (!response.ok) {
          throw new Error('Network response was not ok.');
        }
        return response.json()
      }).then(rawData => {
        if (!rawData) {
          return;
        }
        const parseOpenApiSpec = JSON.parse(rawData.profile);
        setRawSpecDef(parseOpenApiSpec);
        if(parseOpenApiSpec['dataType'] == 'projectType') {
          data = parseOpenApiSpec['children'] || [];
        } else {
          data = coreService.parseOpenApiSpec(parseOpenApiSpec);
        }

        // 调用从 Web Component 传入的回调
        if (onAction) {
          onAction(data);
        }
    });
  }


  const view = (rawSpecBrief: any) => {
  }


  return (
    <div className="h-full flex flex-col bg-gray-50">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <CategorySidebar />
        <MainContent />
        <TrendingProjects />
      </div>
    </div>
  );
}
