import { Cpu, Layers, Code, Cpu as AiIcon, Factory, Link, Wallet, AppWindow } from 'lucide-react';

const categories = [
  { name: 'New Tech', icon: Cpu, active: false },
  { name: 'OpenHarmony', icon: Layers, active: true },
  { name: 'Development Lib', icon: Code, active: false },
  { name: 'AI/ML', icon: AiIcon, active: false },
  { name: 'Industrial', icon: Factory, active: false },
  { name: 'Blockchain', icon: Link, active: false },
  { name: 'Wechat Projects', icon: Wallet, active: false },
  { name: 'Enterprise App', icon: AppWindow, active: false },
];

export function CategorySidebar() {
  return (
    <div className="w-64 bg-white border-r border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" strokeWidth="2"/>
          <rect x="14" y="3" width="7" height="7" strokeWidth="2"/>
          <rect x="14" y="14" width="7" height="7" strokeWidth="2"/>
          <rect x="3" y="14" width="7" height="7" strokeWidth="2"/>
        </svg>
        <h3 className="text-sm">Categories</h3>
      </div>

      <div className="space-y-1">
        {categories.map((category, index) => {
          const Icon = category.icon;
          return (
            <button
              key={index}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                category.active
                  ? 'bg-orange-50 text-orange-600'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{category.name}</span>
              {category.active && (
                <span className="ml-auto text-orange-600">🔥</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
