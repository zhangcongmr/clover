import { ChevronLeft, ChevronRight, Search } from 'lucide-react';

const brands = [
  { name: 'AntV', color: '#6610F2' },
  { name: 'Apollo', color: '#3E67EA' },
  { name: '理想', color: '#000' },
  { name: '滴滴 开源', color: '#FF6A00' },
  { name: 'DolphinScheduler', color: '#3B9FD9' },
  { name: 'dotNET', color: '#512BD4' },
];

export function Header() {
  return (
    <div className="bg-white border-b border-gray-200">
      {/* Brand Carousel */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        
        <div className="flex items-center gap-12 flex-1 justify-center">
          {brands.map((brand, index) => (
            <div key={index} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-lg cursor-pointer transition-colors">
              <div className="w-6 h-6 flex items-center justify-center rounded" style={{ backgroundColor: `${brand.color}20` }}>
                <span className="text-xs" style={{ color: brand.color }}>▲</span>
              </div>
              <span className="text-sm">{brand.name}</span>
            </div>
          ))}
        </div>
        
        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
              <path d="M9 3v18M15 3v18M3 9h18M3 15h18" strokeWidth="2"/>
            </svg>
            <span className="text-sm">Open Source Project</span>
          </button>
          
          <button className="flex items-center gap-2 px-4 py-2 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-sm">Open Source Organization</span>
          </button>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-sm text-gray-500">Trending:</span>
          {['物联网', '地图', 'OceanBase', 'Serverless', '微服务'].map((tag, index) => (
            <button key={index} className="text-sm text-blue-600 hover:text-blue-700 transition-colors">
              {tag}
            </button>
          ))}
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Search className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
