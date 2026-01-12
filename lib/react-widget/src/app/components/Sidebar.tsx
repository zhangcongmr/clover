import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface SidebarItem {
  id: string;
  label: string;
  icon?: string;
  children?: { id: string; label: string }[];
}

const sidebarItems: SidebarItem[] = [
  {
    id: 'templates',
    label: '模版',
    children: [
      { id: 'docs', label: '文档' },
      { id: 'forms', label: '表格' },
      { id: 'slides', label: '幻灯片' },
    ],
  },
  {
    id: 'collections',
    label: '收集表',
  },
  {
    id: 'more',
    label: '更多',
  },
  {
    id: 'wechat-docs',
    label: '腾讯文档',
    children: [
      { id: 'medical', label: '医生必备' },
      { id: 'office', label: '职场必料' },
      { id: 'rights', label: '权威合同' },
      { id: 'demo', label: '汇报演示' },
    ],
  },
  {
    id: 'tools',
    label: '提醒',
    children: [
      { id: 'org-chart', label: '职场编组' },
      { id: 'questionnaire', label: '实践题历' },
      { id: 'finance', label: '财务板表' },
      { id: 'announcements', label: '信息发布' },
    ],
  },
];

export function Sidebar() {
  const [expandedItems, setExpandedItems] = useState<string[]>(['templates', 'wechat-docs']);

  const toggleItem = (id: string) => {
    setExpandedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <aside className="w-40 bg-gray-50 border-r overflow-y-auto">
      <nav className="py-2">
        {sidebarItems.map((item) => (
          <div key={item.id}>
            <button
              onClick={() => item.children && toggleItem(item.id)}
              className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-100 ${
                item.id === 'templates' ? 'bg-white border-l-2 border-blue-500' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                {item.children && (
                  expandedItems.includes(item.id) ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )
                )}
                {item.label}
              </span>
            </button>
            {item.children && expandedItems.includes(item.id) && (
              <div className="pl-6">
                {item.children.map((child) => (
                  <button
                    key={child.id}
                    className="w-full px-4 py-1.5 text-left text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}
