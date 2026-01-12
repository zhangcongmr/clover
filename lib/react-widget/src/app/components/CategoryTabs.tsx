import { useState } from 'react';

const categories = [
  {
    id: 'industry',
    label: '行业模板',
    subcategories: ['教育行业', '行政秘书', '法律', '消息营销', '建设施工', '求职简历'],
  },
  {
    id: 'workplace',
    label: '职场办公',
    subcategories: ['工作计划', '工作汇报', '合规花园', '目标', '周报', '实习实践', '股份投资', '地逢建'],
  },
  {
    id: 'campus',
    label: '校园模版',
    subcategories: ['考试', '作业通', '求组织财'],
  },
  {
    id: 'personal',
    label: '个人生活',
    subcategories: ['旅行清单', '新婚出行', '晒开记账', '个人成长', '医学花法', '利用定财'],
  },
  {
    id: 'style',
    label: '风格类型',
    subcategories: ['小清新', '网络风', '复古风', '中国风', '插画风', '高级感'],
  },
];

export function CategoryTabs() {
  const [activeTab, setActiveTab] = useState('industry');

  const activeCategory = categories.find((cat) => cat.id === activeTab);

  return (
    <div className="border-b bg-white">
      {/* Main tabs */}
      <div className="flex gap-8 px-6">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setActiveTab(category.id)}
            className={`py-3 text-sm relative ${
              activeTab === category.id
                ? 'text-gray-900 font-medium'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {category.label}
            {activeTab === category.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />
            )}
          </button>
        ))}
      </div>

      {/* Subcategories */}
      <div className="px-6 py-3 flex flex-wrap gap-4 text-sm text-gray-600 border-t">
        {activeCategory?.subcategories.map((sub, index) => (
          <button
            key={index}
            className="hover:text-gray-900 transition-colors"
          >
            {sub}
          </button>
        ))}
      </div>
    </div>
  );
}
