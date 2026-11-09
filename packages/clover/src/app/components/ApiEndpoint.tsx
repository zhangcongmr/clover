import { ChevronRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface ApiEndpointProps {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  path: string;
  level?: number;
  isActive?: boolean;
  onClick?: () => void;
}

const methodColors = {
  GET: 'bg-green-100 text-green-700',
  POST: 'bg-orange-100 text-orange-700',
  DELETE: 'bg-red-100 text-red-700',
  PATCH: 'bg-yellow-100 text-yellow-700',
};

export function ApiEndpoint({ method, path, level = 0, isActive = false, onClick }: ApiEndpointProps) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-100 ${
        isActive ? 'bg-gray-100' : ''
      }`}
      style={{ paddingLeft: `${12 + level * 16}px` }}
      onClick={onClick}
    >
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${methodColors[method]}`}>
        {method}
      </span>
      <span className="text-gray-700 font-mono text-xs">{path}</span>
    </div>
  );
}

interface ApiGroupProps {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  label: string;
  path?: string;
  level?: number;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}

export function ApiGroup({ method, label, path, level = 0, children, defaultOpen = false }: ApiGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50"
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={() => setIsOpen(!isOpen)}
      >
        {children && (
          isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
        {method && (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${methodColors[method]}`}>
            {method}
          </span>
        )}
        <span className={`${method ? 'font-mono text-xs' : 'font-medium'} text-gray-700`}>
          {path || label}
        </span>
      </div>
      {isOpen && children && <div>{children}</div>}
    </div>
  );
}
