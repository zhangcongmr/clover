import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { CategoryTabs } from './components/CategoryTabs';
import { TemplateSection } from './components/TemplateSection';
import { coreService } from './core.service';
import { useEffect, useState } from 'react';
const exampleImage = '/assets/js/assets/images/261eac710afe14b74d510b01b971fda8812f648a.png';

// Mock template data
const featuredTemplates = [
  {
    id: '1',
    title: 'AI PPT',
    image: '/assets/js/assets/images/featured-1.jpg',
    isPPT: false,
  },
  {
    id: '2',
    title: '年终总结',
    image: '/assets/js/assets/images/featured-2.jpg',
    isPPT: false,
  },
  {
    id: '3',
    title: '快速记账',
    image: '/assets/js/assets/images/featured-3.jpg',
    isPPT: false,
  },
  {
    id: '4',
    title: '教研办公',
    image: '/assets/js/assets/images/featured-4.jpg',
    isPPT: false,
  },
];

const workPlanTemplates = [
  {
    id: '5',
    title: '2026年度工作计划',
    image: '/assets/js/assets/images/featured-5.jpg',
    isPPT: true,
  },
  {
    id: '6',
    title: '2026新年计划',
    image: '/assets/js/assets/images/featured-6.jpg',
    isPPT: true,
  },
  {
    id: '7',
    title: '红色温暖2026年度...',
    image: '/assets/js/assets/images/featured-7.jpg',
    isPPT: true,
  },
  {
    id: '8',
    title: '2026年度工作计划...',
    image: '/assets/js/assets/images/featured-8.jpg',
    isPPT: true,
  },
  {
    id: '9',
    title: '2026极简年计划提案...',
    image: '/assets/js/assets/images/featured-9.jpg',
    isPPT: true,
  },
  {
    id: '10',
    title: '新年计划',
    image: '/assets/js/assets/images/featured-10.jpg',
    isPPT: true,
  },
];

const workSummaryTemplates = [
  {
    id: '11',
    title: '党政工作总结汇报...',
    image: '/assets/js/assets/images/featured-11.jpg',
    isPPT: true,
  },
  {
    id: '12',
    title: '教学工作总结汇报...',
    image: '/assets/js/assets/images/featured-12.jpg',
    isPPT: true,
  },
  {
    id: '13',
    title: '年末总结新闻年计划',
    image: '/assets/js/assets/images/featured-13.jpg',
    isPPT: true,
  },
  {
    id: '14',
    title: '工作总结与新年计...',
    image: '/assets/js/assets/images/featured-14.jpg',
    isPPT: true,
  },
  {
    id: '15',
    title: '房间吸取总结',
    image: '/assets/js/assets/images/featured-15.jpg',
    isPPT: true,
  },
  {
    id: '16',
    title: '项目经理项目',
    image: '/assets/js/assets/images/featured-16.jpg',
    isPPT: true,
    isFavorited: true,
  },
];

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
    <div className="h-full flex flex-col bg-white">
      <Header />
      
      <div className="flex flex-1 basis-0 overflow-hidden">
        <Sidebar />
        
        <main className="flex-1 overflow-y-auto">
          <CategoryTabs />
          
          <div className="p-6">
            {/* Featured Section */}
            <section className="mb-8">
              <h2 className="text-lg mb-4">行业模板</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {featuredTemplates.map((template) => (
                  <div key={template.id} className="group cursor-pointer">
                    <div className="relative aspect-[16/9] rounded-lg overflow-hidden bg-gradient-to-br from-blue-50 to-purple-50 p-6 flex items-center justify-center">
                      <img 
                        src={baseHref + template.image} 
                        alt={template.title}
                        className="w-full h-full object-cover absolute inset-0"
                      />
                      <div className="relative z-10 text-center">
                        <h3 className="font-medium text-white drop-shadow-lg">{template.title}</h3>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Most Used Section */}
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-5 bg-blue-600 rounded"></div>
                <h2 className="text-lg">最近使用</h2>
              </div>
              <div className="bg-white rounded-lg p-4 border">
                {rawSpecBriefDefs && (
                  <div className="flex flex-wrap gap-3 mt-3">
                    {rawSpecBriefDefs.map((rawSpecBrief, index) => (
                      <div data-layer="outline" className="Outline codigma-outline">
                        <div data-layer="outline-item" className="OutlineItem codigma-outline-item">
                          <div data-layer="outline-title" className="OutlineTitle codigma-outline-title" onClick={()=> view(rawSpecBrief)}>
                            <div data-layer="outline-title-text" className="OutlineTitleText codigma-outline-title-text">
                              {rawSpecBrief['name']}
                            </div>
                          </div>
                          <div data-layer="type" className="Type codigma-type">
                            <div data-layer="type-text" className="TypeText codigma-outline-title-text">openapi {rawSpecBrief['type']}</div>
                          </div>
                            <div data-layer="operation" className="Operation codigma-operation">
                              <div data-layer="oper-btn" className="OperBtn codigma-oper-btn" onClick={()=> view(rawSpecBrief)}>
                                <div data-layer="view-btn-text" className="btn-text codigma-view-btn-text">View</div>
                              </div>
                              <div data-layer="oper-btn" className="OperBtn codigma-oper-btn" onClick={()=> importFromApiDef(rawSpecBrief)}>
                                <div data-layer="fetch-btn-text" className="btn-text codigma-view-btn-text">Import</div>
                              </div>
                            </div>
                        </div>
                        <div data-layer="desc-details-sec" className="DescDetailsSec codigma-desc-details-sec">
                          <div data-layer="desc-cnr" className="DescCnr codigma-desc-cnr">
                            <div data-layer="desc-sec" className="DescSec codigma-desc-sec">
                              <div data-layer="desc" className="Desc codigma-style-0">From service-1</div>
                            </div>
                            <div data-layer="desc-sec" className="DescSec codigma-desc-sec">
                              <div data-layer="desc" className="Desc codigma-style-0">16 Oct, 2025</div>
                            </div>
                          </div>
                          <div data-layer="desc-sec" className="DescSec codigma-desc-sec">
                            <div data-layer="desc" className="Desc">{rawSpecBrief['description']}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Hot Topics Section */}
            <TemplateSection
              title="热门话题"
              tags={[
                '榜单分析',
                '年度总结',
                '乌龟年绘图',
                '电器管理软件',
                '电器设施',
                '紫色萧箫',
                '家长手册',
                '老爱建康',
              ]}
              templates={workPlanTemplates}
              baseHref = {baseHref}
            />

            {/* Workplace Office Section */}
            <TemplateSection
              title="职场办公"
              tags={[
                '总结汇报',
                '育地办公',
                '部落本金',
                '词解技能',
                '关机成绩',
                '秦川建评',
                '陕建边设',
                '责值分析',
              ]}
              templates={ workSummaryTemplates}
              baseHref = {baseHref}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
