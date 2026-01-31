import { Star, TrendingUp } from 'lucide-react';

const trendingProjects = [
  {
    name: 'lobase/LuBase',
    stars: '22k',
    description: '基于 SpringBoot3+Vue3 打造的高性能低代码开发平台，支持企业级应用，多类型组件，跨平台兼容，提供可视化搭建界面。原生支持移动端开发，数据统计等功能。',
    tag: 'Vue',
    tagColor: '#42b883'
  },
  {
    name: 'jeelowcode/JeeLowCode',
    stars: '10.1k',
    description: '【企业级低代码】一一套轻量级的企业级开发框架（极速开发），以具备即插即用的独立组件，支持快速部署，有效提升开发效率。',
    tag: 'JeeLowCode',
    tagColor: '#ff6a00'
  },
  {
    name: '搭华深圳AI开源训队N/M/AI...',
    stars: '1.1k',
    description: 'AI手环开发，AI获客手机管理，智能客服、信息流、RPA，让企业用智能化手段，优化用户服务，高效进行市场推广，简化用品，高化营销功效...',
    tag: 'RPA',
    tagColor: '#3b82f6'
  }
];

export function TrendingProjects() {
  return (
    <div className="w-96 bg-white border-l border-gray-200 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm">Trending Projects</h3>
        <div className="flex gap-2">
          <button className="px-3 py-1 text-xs bg-orange-100 text-orange-600 rounded">
            Today
          </button>
          <button className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded">
            Weekly
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {trendingProjects.map((project, index) => (
          <div key={index} className="pb-4 border-b border-gray-100 last:border-0 relative">
            {index === 1 && (
              <div className="absolute -right-4 top-0 w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
            )}
            
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-sm text-gray-900 flex-1 pr-2">{project.name}</h4>
              <div className="flex items-center gap-1 text-gray-500">
                <Star className="w-3 h-3" />
                <span className="text-xs">{project.stars}</span>
              </div>
            </div>
            
            <p className="text-xs text-gray-600 mb-2 line-clamp-3">
              {project.description}
            </p>
            
            <div className="flex items-center gap-2">
              <span 
                className="px-2 py-0.5 text-xs rounded"
                style={{ 
                  backgroundColor: `${project.tagColor}20`,
                  color: project.tagColor
                }}
              >
                {project.tag}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
