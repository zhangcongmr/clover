import { RefreshCw, Flame, TrendingUp } from "lucide-react";

export function RightSidebar() {
  const developers = [
    {
      username: "suns769675",
      description: "no introduction",
      avatar: "/static/images/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop",
      initial: "S",
    },
    {
      username: "老花生",
      description: "一只是送生老鸭汤老",
      avatar: "/static/images/photo-1599566150163-29194dcaad36?w=100&h=100&fit=crop",
      initial: "老",
    },
    {
      username: "Hccake",
      description: "no introduction",
      avatar: "/static/images/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop",
      initial: "H",
    },
    {
      username: "心莫離",
      description: "no introduction",
      avatar: "/static/images/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop",
      initial: "心",
    },
    {
      username: "quick123official",
      description: "no introduction",
      avatar: "/static/images/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop",
      initial: "Q",
    },
  ];

  const repositories = [
    {
      name: "rt-thread",
      tag: "GVP",
      description: "RT-Thread是一个来自中国的开源物联网操作系统...",
      icon: "🔥",
      stars: "5.1K",
      color: "text-orange-500",
    },
    {
      name: "私有客家（微信小程序版）",
      description: "私有客家（微信小程序版）主要功能：食物记录...",
      icon: "📱",
      stars: "6.7K",
      color: "text-gray-600",
    },
    {
      name: "PDMan",
      tag: "GVP",
      description: "PDMan是一款开源免费的数据库模型建模工具...",
      icon: "💾",
      stars: "8.8K",
      color: "text-gray-600",
    },
  ];

  return (
    <aside className="w-80 border-l border-gray-200 bg-white overflow-y-auto flex-shrink-0">
      <div className="p-4">
        {/* Developers to Follow */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-pink-500">💝</span>
              <h2 className="font-medium text-gray-900">Developers To Follow</h2>
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {developers.map((dev, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white flex-shrink-0 overflow-hidden">
                  {index === 0 ? (
                    <div className="w-full h-full bg-gray-300"></div>
                  ) : (
                    <img
                      src={dev.avatar}
                      alt={dev.username}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-gray-900 truncate">
                    {dev.username}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {dev.description}
                  </div>
                </div>
                <button className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 flex-shrink-0">
                  Follow
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Repositories For You */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              <h2 className="font-medium text-gray-900">Repositories For You</h2>
            </div>
            <button className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {repositories.map((repo, index) => (
              <div key={index} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="flex items-start gap-2 mb-2">
                  <a
                    href="#"
                    className="text-blue-600 hover:text-blue-800 font-medium text-sm flex items-center gap-1"
                  >
                    {repo.name}
                    {repo.tag && (
                      <span className="bg-yellow-400 text-yellow-900 text-xs px-1.5 py-0.5 rounded font-semibold">
                        {repo.tag}
                      </span>
                    )}
                  </a>
                  <button className="ml-auto text-gray-400 hover:text-gray-600">
                    <TrendingUp className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-600 mb-2 line-clamp-2">
                  {repo.description}
                </p>
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className={repo.color}>{repo.icon}</span>
                    {repo.stars}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
