import { ChevronDown, Calendar } from "lucide-react";

export function EventsFeed() {
  const events = [
    {
      type: "starred",
      user: "tyx",
      action: "starred projects",
      time: "11 minutes ago",
      repo: {
        name: "新增解/password-vi",
        description: "开源免费的密码管理项目，功能丰富、对新鸟友好、双端使用",
        lastUpdate: "Recently update on 11 minutes ago",
      },
    },
  ];

  const commits = [
    {
      hash: "112433e",
      message: "fix: clear log print",
      time: "31 minutes ago",
      branch: "master branch of tyx/clover",
    },
    {
      hash: "0822a83",
      message: "fix: view png",
      time: "31 minutes ago",
      branch: "master branch of tyx/clover",
    },
  ];

  return (
    <main className="flex-1 overflow-y-auto bg-white">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Events</h1>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
            All events
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        {/* Date */}
        <div className="flex items-center gap-2 mb-4 text-gray-600">
          <Calendar className="w-4 h-4" />
          <span className="text-sm">2026-01-14</span>
        </div>

        {/* Events */}
        <div className="space-y-6">
          {events.map((event, index) => (
            <div key={index} className="border-b border-gray-100 pb-6">
              {/* User info */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-pink-200 flex-shrink-0">
                  <img
                    src="/static/images/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop"
                    alt={event.user}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="font-medium text-gray-900">{event.user}</div>
                  <div className="text-sm text-gray-500">
                    {event.action} {event.time}
                  </div>
                </div>
              </div>

              {/* Repository card */}
              <div className="ml-13 border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-sm">📁</span>
                  <div className="flex-1">
                    <a
                      href="#"
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {event.repo.name}
                    </a>
                  </div>
                </div>
                <p className="text-sm text-gray-700 mb-2 ml-6">
                  {event.repo.description}
                </p>
                <p className="text-xs text-gray-500 ml-6">
                  {event.repo.lastUpdate}
                </p>
              </div>
            </div>
          ))}

          {/* Push events */}
          {commits.map((commit, index) => (
            <div key={index} className="border-b border-gray-100 pb-4">
              <div className="mb-2">
                <span className="text-sm text-gray-600">
                  pushed to branch
                  <span className="text-gray-400 ml-2">{commit.time}</span>
                </span>
              </div>
              <div className="ml-4 text-sm">
                <div className="text-gray-500 mb-1">{commit.branch}</div>
                <div className="flex items-center gap-2">
                  <code className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">
                    {commit.hash}
                  </code>
                  <span className="text-gray-700">{commit.message}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Load more */}
        <div className="flex justify-center mt-8">
          <button className="text-sm text-gray-500 hover:text-gray-700">
            ••• •••• ••• •••
          </button>
        </div>
      </div>
    </main>
  );
}
