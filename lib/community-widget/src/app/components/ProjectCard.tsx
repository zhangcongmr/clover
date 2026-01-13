import { Star, GitFork, Eye } from 'lucide-react';
import { useState } from 'react';
import { coreService } from '../core.service';

interface ProjectCardProps {
  project: {
    avatar: string;
    name: string;
    starred: boolean;
    description: string;
    specType: string;
    specColor: string;
    category: string;
    timeAgo: string;
    stars: string;
  };
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export function ProjectCard({ project, onAction }: ProjectCardProps) {
  let data: any = [];
  const [rawSpecDef, setRawSpecDef] = useState({});

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
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white flex-shrink-0">
          {project.avatar}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm text-blue-600 hover:text-blue-700 cursor-pointer" onClick={()=> importFromApiDef(project)}>
              {project.name}
            </h4>
            {project.starred && (
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
            )}
          </div>
          
          <p className="text-sm text-gray-600 mb-3 line-clamp-2">
            {project.description}
          </p>
          
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: project.specColor }}></span>
              <span>{project.specType}</span>
            </div>
            <div className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
              </svg>
              <span>{project.category}</span>
            </div>
            <span>|</span>
            <span>{project.timeAgo}</span>
          </div>
        </div>
        
        <button className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 transition-colors">
          <Star className="w-3 h-3" />
          <span className="text-xs">{project.stars}</span>
        </button>
      </div>
    </div>
  );
}
