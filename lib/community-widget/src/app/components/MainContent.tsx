import { useEffect, useState } from 'react';
import { ProjectCard } from './ProjectCard';

const recommendedProjects = [
  {
    avatar: 'YP',
    name: 'ygephp/MediaCast',
    starred: true,
    description: '随时随地一一直至了一个由OpenAI 开发的媒体播放器工具，支持在网络站里上传图片、视频、文件等媒体内容，以网页形式提供。',
    language: 'PHP',
    languageColor: '#4F5D95',
    category: '10 libraries',
    timeAgo: '12 hours ago',
    stars: '34'
  },
  {
    avatar: 'WX',
    name: 'Wang Xin/oar-ocr',
    starred: false,
    description: 'A comprehensive OCR library, built in Rust with ONNX Runtime for efficient inference.',
    language: 'Rust',
    languageColor: '#dea584',
    category: 'Computer Vision/Face Recognition',
    timeAgo: '2 hours ago',
    stars: '26'
  },
  {
    avatar: '黄',
    name: '黄艳鹏/password-xl',
    starred: false,
    description: '开源免费的密码管理器项目，功能丰富、页面美观、双端兼容',
    language: 'Security Dev',
    languageColor: '#f1e05a',
    category: '',
    timeAgo: '10 hours ago',
    stars: '34'
  }
];

export function MainContent() {
  // ✅ 将 fetch 放入 useEffect
  const [rawSpecBriefDefs, setRawSpecBriefDefs] = useState([]);
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


  return (
    <div className="flex-1 bg-gray-50 p-6 overflow-y-auto">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg">Recommend projects</h2>
          <button className="text-sm text-blue-600 hover:text-blue-700">
            More
          </button>
        </div>

        <div className="space-y-4">
          {rawSpecBriefDefs.map((project, index) => (
            <ProjectCard key={index} project={project} />
          ))}
        </div>
      </div>
    </div>
  );
}
