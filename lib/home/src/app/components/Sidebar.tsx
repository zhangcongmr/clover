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
} from "lucide-react";

export function Sidebar() {
  const repositories = [
    "tyx/clover",
    "tyx/dropwiz-example",
    "tyx/fullstack-alipay-demo",
    "tyx/test-simple",
    "tyx/spring-security-demo",
  ];

  return (
    <aside className="w-52 border-r border-gray-200 bg-gray-50 overflow-y-auto flex-shrink-0">
      <div className="p-4">
        {/* Dashboard */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
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
              className="flex items-center gap-2 text-sm text-gray-900 py-1"
            >
              <FolderGit2 className="w-4 h-4" />
              Repositories
              <span className="text-xs text-gray-500">12</span>
            </a>
            <Search className="w-3.5 h-3.5 text-gray-400" />
          </div>

          <div className="ml-6 space-y-1">
            {repositories.map((repo, index) => (
              <a
                key={index}
                href="#"
                className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 py-1"
              >
                <FolderGit2 className="w-3.5 h-3.5" />
                {repo}
              </a>
            ))}
            <button className="text-sm text-gray-500 hover:text-gray-700 py-1">
              Load all
            </button>
          </div>
        </div>

        {/* Pull Request */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <GitPullRequest className="w-4 h-4" />
            Pull Request
          </a>
        </div>

        {/* Issues */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <AlertCircle className="w-4 h-4" />
            Issues
          </a>
        </div>

        {/* Gists */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <Code2 className="w-4 h-4" />
            Gists
            <span className="text-xs text-gray-500">2</span>
          </a>
        </div>

        {/* My collections */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <BookmarkPlus className="w-4 h-4" />
            My collections
            <span className="text-xs text-gray-500">1</span>
          </a>
        </div>

        {/* My enterprise */}
        <div className="mb-4">
          <a
            href="#"
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 py-1"
          >
            <Building2 className="w-4 h-4" />
            My enterprise / Education / Organization
          </a>
        </div>
      </div>
    </aside>
  );
}
