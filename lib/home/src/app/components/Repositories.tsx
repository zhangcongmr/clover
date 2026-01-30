import { useState, useEffect } from "react";
import { Eye, Star, GitFork, Search as SearchIcon, ChevronDown } from "lucide-react";

interface Repository {
  name: string;
  language?: string;
  lastUpdated: string;
  views: number;
  stars: number;
  forks: number;
  isPrivate?: boolean;
}

export function Repositories() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activeTab, setActiveTab] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRepositories = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://127.0.0.1:8980/user/briefsByUserName?userName=Jack Mordan');
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error('API endpoint not available - using mock data');
        }
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        // Process data here when API is available
        setRepositories([]);
      } catch (err) {
        console.error('Error fetching repositories:', err);
        // Use mock data
        setRepositories([
          {
            name: "tyy/clover",
            lastUpdated: "16 minutes ago",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
          {
            name: "tyy/spring-security-demo",
            language: "Java",
            lastUpdated: "yesterday 21:52",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
          {
            name: "tyy/dropwz-example",
            lastUpdated: "Jan 28 11:21",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
          {
            name: "tyy/fullstack-alipay-demo",
            lastUpdated: "Jan 13 09:31",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
          {
            name: "tyy/test-simple",
            lastUpdated: "Jan 8 10:16",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
          {
            name: "tyy/py-demo",
            lastUpdated: "Jan 3 15:20",
            views: 1,
            stars: 0,
            forks: 0,
            isPrivate: false,
          },
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchRepositories();
  }, []);

  const publicCount = repositories.filter(r => !r.isPrivate).length;
  const privateCount = repositories.filter(r => r.isPrivate).length;

  return (
    <div className="flex-1 bg-white overflow-y-auto">
      {/* Breadcrumb */}
      <div className="border-b border-gray-200 px-6 py-3">
        <div className="text-sm text-gray-600">
          <span className="hover:text-gray-900 cursor-pointer">Dashboard</span>
          <span className="mx-2">/</span>
          <span className="text-gray-900">Repositories</span>
        </div>
      </div>

      {/* Enterprise message */}
      <div className="border-b border-gray-200 px-6 py-3 bg-gray-50">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            To view enterprise's Projects, please select the enterprise you want to enter.
          </span>
          <button className="flex items-center gap-1 text-gray-900 hover:text-gray-700">
            Select enterprise
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab("all")}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeTab === "all"
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveTab("mine")}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeTab === "mine"
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Mine
            </button>
            <button
              onClick={() => setActiveTab("contributions")}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeTab === "contributions"
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Contributions
            </button>
            <button
              onClick={() => setActiveTab("forks")}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeTab === "forks"
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Forks
            </button>
            <button
              onClick={() => setActiveTab("paused")}
              className={`py-3 text-sm border-b-2 transition-colors ${
                activeTab === "paused"
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              Pause/Closed
            </button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              className="w-64 h-8 pl-3 pr-8 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            />
            <SearchIcon className="w-4 h-4 absolute right-2 top-2 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Filter and Sort */}
      <div className="border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveFilter("all")}
              className={`text-sm ${
                activeFilter === "all"
                  ? "text-gray-900 font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter("public")}
              className={`text-sm ${
                activeFilter === "public"
                  ? "text-gray-900 font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Public <span className="text-gray-500">{publicCount}</span>
            </button>
            <button
              onClick={() => setActiveFilter("private")}
              className={`text-sm ${
                activeFilter === "private"
                  ? "text-gray-900 font-medium"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Private <span className="text-gray-500">{privateCount}</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
              选择标签
              <ChevronDown className="w-3 h-3" />
            </button>
            <button className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
              Last updated
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Repository List */}
      <div className="px-6 py-4">
        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <div className="space-y-4">
            {repositories.map((repo, index) => (
              <div
                key={index}
                className="flex items-center gap-4 py-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                {/* Repository Icon */}
                <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <svg
                    className="w-5 h-5 text-gray-500"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5v-9zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8V1.5z" />
                  </svg>
                </div>

                {/* Repository Info */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-base text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                    {repo.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    {repo.language && (
                      <span className="text-xs text-gray-600">
                        <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1"></span>
                        {repo.language}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      Last updated {repo.lastUpdated}
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <Eye className="w-4 h-4" />
                    <span>{repo.views}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4" />
                    <span>{repo.stars}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <GitFork className="w-4 h-4" />
                    <span>{repo.forks}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
