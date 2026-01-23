import { Search, Bell, HelpCircle, ChevronDown } from "lucide-react";

export function Header() {
  return (
    <header className="h-14 border-b border-gray-200 flex items-center px-4 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-8">
        <div className="w-7 h-7 bg-red-600 rounded-full flex items-center justify-center">
          <span className="text-white font-bold text-sm">A</span>
        </div>
        <span className="font-semibold text-xl">Luxio</span>
      </div>

      {/* Navigation */}
      <nav className="flex items-center gap-6 flex-1">
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900">
          Explore
        </a>
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900">
          Enterprises
        </a>
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900">
          Education
        </a>
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900">
          Luxio Premium
        </a>
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1">
          Luxio AI
          <span className="text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white px-1 rounded">
            AI
          </span>
        </a>
        <a href="#" className="text-sm text-gray-700 hover:text-gray-900">
          AI Teammates
        </a>
        <button className="text-sm text-gray-700 hover:text-gray-900 flex items-center gap-1">
          My
          <ChevronDown className="w-3 h-3" />
        </button>
      </nav>

      {/* Right section */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search"
            className="w-64 h-8 pl-3 pr-8 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          />
          <Search className="w-4 h-4 absolute right-2 top-2 text-gray-400" />
        </div>

        {/* Icons */}
        <button className="text-gray-600 hover:text-gray-900">
          <Bell className="w-5 h-5" />
        </button>
        <button className="text-gray-600 hover:text-gray-900">
          <HelpCircle className="w-5 h-5" />
        </button>

        {/* User avatar */}
        <button className="flex items-center gap-1">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-pink-200">
            <img
              src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop"
              alt="User"
              className="w-full h-full object-cover"
            />
          </div>
          <ChevronDown className="w-3 h-3 text-gray-600" />
        </button>
      </div>
    </header>
  );
}
