import { ProjectCard } from './ProjectCard';
import { useEffect, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ApiBriefDocument } from '@luxio/common';
import { coreService } from '../core.service';

export function MainContent() {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const itemsPerPage = 10;
  // ✅ 将 fetch 放入 useEffect
  const [rawSpecBriefDefs, setRawSpecBriefDefs] = useState<ApiBriefDocument[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/user/allBriefs");
        if (!response.ok) {
          throw new Error('Network response was not ok.');
        }
        const rawData: Array<ApiBriefDocument> = await response.json();
        for (let item of rawData) {
          item.timeAgo = coreService.timeAgoIntl(item.updatetime);
        }
        if (rawData) {
          setRawSpecBriefDefs(rawData);
        }
      } catch (error) {
        console.error('Fetch error:', error);
      }
    };

    fetchData();
  }, []); // 👈 空依赖数组：只在组件挂载时执行一次

  // Filter projects based on search query
  const filteredProjects = useMemo(() => {
    if (!searchQuery) return rawSpecBriefDefs; // 不搜时返回全部

    const query = searchQuery.toLowerCase();
    return rawSpecBriefDefs.filter(project => {
      return (
        project.name.toLowerCase().includes(query) ||
        project.description?.toLowerCase().includes(query) ||
        // project.language.toLowerCase().includes(query) ||
        project.category?.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, rawSpecBriefDefs]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredProjects.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentProjects = filteredProjects.slice(startIndex, endIndex);

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
    <div className="flex-1 bg-gray-50 p-6 overflow-y-hidden">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg">All projects</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Showing {startIndex + 1}-{Math.min(endIndex, filteredProjects.length)} of {filteredProjects.length}
            </span>
            <button className="text-sm text-blue-600 hover:text-blue-700">
              More
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search projects by name, description, language, or category..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <span className="text-xl">×</span>
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="mt-2 text-sm text-gray-600">
              Found {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''} matching "{searchQuery}"
            </p>
          )}
        </div>

        {/* Pagination Controls - Top */}
        {filteredProjects.length > 0 && (
          <div className="mb-6">
            <PaginationControls />
          </div>
        )}

        <div className="space-y-4">
          {currentProjects.length > 0 ? (
            currentProjects.map((project, index) => (
              <ProjectCard key={startIndex + index} project={project} />
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

        {/* Pagination Controls - Bottom */}
        {filteredProjects.length > 0 && (
          <div className="mt-8">
            <PaginationControls />
          </div>
        )}
      </div>
    </div>
  );
}