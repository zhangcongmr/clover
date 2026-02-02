import { set } from "date-fns";
import {
  LayoutDashboard,
  FolderGit2,
  Search,
  GitPullRequest,
  AlertCircle,
  Code2,
  BookmarkPlus,
  Building2,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiBriefDocument } from "@luxio/common";

interface Repository {
  name: string;
  fullName?: string;
}

interface SidebarProps {
  onNavigateToRepositories: () => void;
  onNavigateToDashboard: () => void;
  currentView: "dashboard" | "repositories";
}

export function Sidebar({ onNavigateToRepositories, onNavigateToDashboard, currentView }: SidebarProps) {
  const [repositories, setRepositories] = useState<ApiBriefDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRepositories = async () => {
      try {
        setLoading(true);
        const response = await fetch('/user/briefsByUserName?userName=Jack Mordan');
        
        // Check if response is JSON
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('API endpoint not available - using mock data');
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: Array<ApiBriefDocument> = await response.json();
        setRepositories(data);        
        setError(null);
      } catch (err) {
        console.error('Error fetching repositories:', err);
        // Use mock data if API is not available
        // setRepositories([
        //   "tyx/clover",
        //   "tyx/dropwiz-example",
        //   "tyx/fullstack-alipay-demo",
        //   "tyx/test-simple",
        //   "tyx/spring-security-demo",
        // ]);
        setError(null); // Don't show error, just use mock data silently
      } finally {
        setLoading(false);
      }
    };

    fetchRepositories();
  }, []);

  return (
    <aside className="w-52 border-r border-gray-200 bg-gray-50 overflow-y-auto flex-shrink-0">
      <div className="p-4">
        {/* Dashboard */}
        <div className="mb-4">
          <a
            href="#"
            className={`flex items-center gap-2 text-sm py-1 ${
              currentView === "dashboard"
                ? "text-red-600 font-medium"
                : "text-gray-600 hover:text-gray-900"
            }`}
            onClick={(e) => {
              e.preventDefault();
              onNavigateToDashboard();
            }}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </a>
        </div>

        {/* Repositories */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <a
              href="#"
              className={`flex items-center gap-2 text-sm py-1 ${
                currentView === "repositories"
                  ? "text-red-600 font-medium"
                  : "text-gray-900 hover:text-red-600"
              }`}
              onClick={(e) => {
                e.preventDefault();
                onNavigateToRepositories();
              }}
            >
              <FolderGit2 className="w-4 h-4" />
              Repositories
              <span className="text-xs text-gray-500">{repositories.length}</span>
            </a>
            <Search className="w-3.5 h-3.5 text-gray-400" />
          </div>

          <div className="ml-6 space-y-1">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : error && repositories.length === 0 ? (
              <div className="text-sm text-red-500 py-1">
                {error}
              </div>
            ) : (
              <>
                {repositories.slice(0, 5).map((repo, index) => (
                  <a
                    key={index}
                    href={"/editor/" + repo.id}
                    target="_blank"
                    className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 py-1"
                  >
                    <FolderGit2 className="w-3.5 h-3.5" />
                    {repo.name || "Unnamed Repo"}
                  </a>
                ))}
                {repositories.length > 5 && (
                  <button className="text-sm text-gray-500 hover:text-gray-700 py-1">
                    Load all
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pull Request */}
        {/* <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <GitPullRequest className="w-4 h-4" />
            Pull Request
          </a>
        </div> */}

        {/* Issues */}
        {/* <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <AlertCircle className="w-4 h-4" />
            Issues
          </a>
        </div> */}

        {/* Gists */}
        {/* <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <Code2 className="w-4 h-4" />
            Gists
            <span className="text-xs text-gray-500">2</span>
          </a>
        </div> */}

        {/* My collections */}
        {/* <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <BookmarkPlus className="w-4 h-4" />
            My collections
            <span className="text-xs text-gray-500">1</span>
          </a>
        </div> */}

        {/* My enterprise */}
        {/* <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <Building2 className="w-4 h-4" />
            My enterprise / Education / Organization
          </a>
        </div> */}
      </div>
    </aside>
  );
}
