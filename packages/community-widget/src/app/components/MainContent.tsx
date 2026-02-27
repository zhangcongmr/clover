import { ProjectCard } from './ProjectCard';
import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { debounce } from 'lodash'; // 或自己实现
import { NodeDef } from '@luxio/common';
import { coreService } from '../core.service';

interface Data {
  list: NodeDef[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ApiResponse {
  data: Data;
  code: number;
  message: string;
}

export function MainContent() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [projects, setProjects] = useState<NodeDef[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsPerPage = 10;
  const searchInputRef = useRef<HTMLInputElement>(null);

// 防抖函数只更新 committedSearch
const debouncedSetCommittedSearch = useRef(
  debounce((query: string) => {
    setCommittedSearch(query); // ✅ 只在这里提交搜索词
    setCurrentPage(1);
  }, 300)
).current;

useEffect(() => {
  return () => {
    debouncedSetCommittedSearch.cancel();
  };
}, [debouncedSetCommittedSearch]);

  // Fetch projects from server
  useEffect(() => {
    const fetchProjects = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const params = new URLSearchParams({
          page: currentPage.toString(),
          pageSize: itemsPerPage.toString(),
          search: committedSearch,
        });

        const response = await fetch(`/user/allBriefs?${params.toString()}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data: ApiResponse = await response.json();
        for (let item of data.data.list) {
          item.timeAgo = coreService.timeAgoIntl(item.updatetime);
        }
        setProjects(data.data.list);
        setTotalProjects(data.data.total);
        setTotalPages(data.data.totalPages);
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError('Failed to load projects. Please try again later.');
        
        // Fallback to mock data for development/demo purposes
        // const mockProjects = generateMockProjects(currentPage, itemsPerPage, searchQuery);
        // setProjects(mockProjects.data);
        // setTotalProjects(mockProjects.total);
        // setTotalPages(mockProjects.totalPages);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [currentPage, committedSearch]);

  const goToPage = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToPrevious = () => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
    }
  };

  const goToNext = () => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
    }
  };

  // Reset to first page when search query changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  debouncedSetCommittedSearch(e.target.value); // ⏳ 防抖后提交
  };

// 清空搜索
const clearSearch = () => {
  setSearchQuery('');
  setCommittedSearch(''); // ✅ 立即清空并触发搜索
  setCurrentPage(1);
};
  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;
    
    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  // Pagination component
  const PaginationControls = () => (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={goToPrevious}
        disabled={currentPage === 1}
        className="p-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      {getPageNumbers().map((page, index) => (
        typeof page === 'number' ? (
          <button
            key={index}
            onClick={() => goToPage(page)}
            className={`min-w-[40px] h-10 px-3 rounded-md transition-colors ${
              currentPage === page
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-700'
            }`}
          >
            {page}
          </button>
        ) : (
          <span key={index} className="px-2 text-gray-500">
            {page}
          </span>
        )
      ))}

      <button
        onClick={goToNext}
        disabled={currentPage === totalPages}
        className="p-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );

  return (
    <div className="flex-1 bg-gray-50 p-6 overflow-y-auto" style={{ overflowY: 'scroll', scrollbarGutter: 'stable' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg">All projects</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {loading ? 'Loading...' : `Showing ${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, totalProjects)} of ${totalProjects}`}
            </span>
            <button className="text-sm text-blue-600 hover:text-blue-700">
              More
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Search Input */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects by name, description, language, or category..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
              ref={searchInputRef}
            />
            {searchQuery && (
              <button
                onClick={() => {
                  clearSearch
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                disabled={loading}
              >
                <span className="text-xl">×</span>
              </button>
            )}
          </div>
          {searchQuery && !loading && (
            <p className="mt-2 text-sm text-gray-600">
              Found {totalProjects} project{totalProjects !== 1 ? 's' : ''} matching "{searchQuery}"
            </p>
          )}
        </div>

        {/* Pagination Controls - Top */}
        {!loading && totalProjects > 0 && (
          <div className="mb-6">
            <PaginationControls />
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(itemsPerPage)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gray-200 rounded"></div>
                  <div className="flex-1 space-y-3">
                    <div className="h-5 bg-gray-200 rounded w-1/3"></div>
                    <div className="h-4 bg-gray-200 rounded w-full"></div>
                    <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {projects.length > 0 ? (
              projects.map((project, index) => (
                <ProjectCard key={`${currentPage}-${index}`} project={project} />
              ))
            ) : (
              <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg text-gray-600 mb-2">No projects found</h3>
                <p className="text-sm text-gray-500">
                  Try adjusting your search query
                </p>
              </div>
            )}
          </div>
        )}

        {/* Pagination Controls - Bottom */}
        {!loading && totalProjects > 0 && (
          <div className="mt-8">
            <PaginationControls />
          </div>
        )}
      </div>
    </div>
  );
}

// Mock data generator for development/demo purposes
function generateMockProjects(page: number, pageSize: number, searchQuery: string): ApiResponse {
  const languages = [
    { name: 'PHP', color: '#4F5D95' },
    { name: 'Rust', color: '#dea584' },
    { name: 'JavaScript', color: '#f1e05a' },
    { name: 'TypeScript', color: '#3178c6' },
    { name: 'Python', color: '#3572A5' },
    { name: 'Java', color: '#b07219' },
    { name: 'Go', color: '#00ADD8' },
    { name: 'C++', color: '#f34b7d' },
    { name: 'Ruby', color: '#701516' },
    { name: 'Swift', color: '#ffac45' },
  ];

  const categories = [
    '10 libraries',
    'Computer Vision/Face Recognition',
    'Security Dev',
    'Web Development',
    'Machine Learning',
    'DevOps',
    'Mobile Development',
    'Data Science',
    'Cloud Computing',
    'Blockchain',
  ];

  const projectNames = [
    'MediaCast',
    'oar-ocr',
    'password-xl',
    'api-gateway',
    'ml-toolkit',
    'cloud-native-app',
    'react-dashboard',
    'auth-service',
    'data-pipeline',
    'blockchain-explorer',
  ];

  const usernames = [
    'ygephp',
    'Wang Xin',
    '黄艳鹏',
    'john-dev',
    'sarah-code',
    'tech-team',
    'opensource-lab',
    'dev-masters',
    'code-ninjas',
    'innovation-hub',
  ];

  const descriptions = [
    'A powerful and flexible tool for modern development workflows.',
    'Built with performance and scalability in mind.',
    'Open source project with comprehensive documentation.',
    'Enterprise-grade solution with advanced features.',
    'Lightweight and easy to integrate into existing projects.',
    'Cross-platform support with native performance.',
    'Actively maintained with regular updates and improvements.',
    'Designed for developers, by developers.',
    'Secure, reliable, and production-ready.',
    'Feature-rich with an intuitive user interface.',
  ];

  const projects: Project[] = [];
  const totalProjects = 100;
  const totalPages = Math.ceil(totalProjects / pageSize);
  
  for (let i = 0; i < totalProjects; i++) {
    const lang = languages[i % languages.length];
    const username = usernames[i % usernames.length];
    const projectName = projectNames[i % projectNames.length];
    
    projects.push({
      avatar: username.substring(0, 2).toUpperCase(),
      name: `${username}/${projectName}-${i + 1}`,
      starred: Math.random() > 0.7,
      description: descriptions[i % descriptions.length],
      language: lang.name,
      languageColor: lang.color,
      category: categories[i % categories.length],
      timeAgo: `${Math.floor(Math.random() * 24)} hours ago`,
      stars: String(Math.floor(Math.random() * 100) + 1),
    });
  }

  // Filter projects based on search query
  const filteredProjects = projects.filter(project => {
    const query = searchQuery.toLowerCase();
    return (
      project.name.toLowerCase().includes(query) ||
      project.description.toLowerCase().includes(query) ||
      project.language.toLowerCase().includes(query) ||
      project.category.toLowerCase().includes(query)
    );
  });

  // Calculate pagination
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentProjects = filteredProjects.slice(startIndex, endIndex);

  return {
    data: currentProjects,
    total: filteredProjects.length,
    page: page,
    pageSize: pageSize,
    totalPages: totalPages,
  };
}