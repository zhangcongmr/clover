import { Search, Bell, HelpCircle, ChevronDown, User, Settings, Star, FileText, LogOut, LogIn } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";


interface HeaderProps {
  isAuthenticated: boolean;
  onLogin: () => void;
  onLogout: () => void;
}

export function Header({ isAuthenticated, onLogin, onLogout }: HeaderProps) {
  const handleSignOut = async () => {
    onLogout();
  };

  const handleMyProfile = () => {
    // Navigate to profile page
    console.log("Navigating to profile...");
    // window.location.href = '/profile';
    alert("Navigating to My Profile");
  };

  const handleMyStars = () => {
    // Navigate to starred repositories
    console.log("Navigating to stars...");
    // window.location.href = '/stars';
    alert("Navigating to My Stars");
  };

  const handleMyGists = () => {
    // Navigate to gists page
    console.log("Navigating to gists...");
    // window.location.href = '/gists';
    alert("Navigating to My Gists");
  };

  const handleSettings = () => {
    // Navigate to settings page
    console.log("Navigating to settings...");
    // window.location.href = '/settings';
    alert("Navigating to Settings");
  };

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

        {/* User avatar with dropdown */}
        {/* Conditional rendering: Login button or User avatar with dropdown */}
        {!isAuthenticated ? (
          <button 
            onClick={onLogin}
            className="flex items-center gap-2 px-4 py-1.5 text-sm text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span>Login</span>
          </button>
        ) : (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-1 hover:opacity-80">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-pink-200">
                  <img
                    src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop"
                    alt="User"
                    className="w-full h-full object-cover"
                  />
                </div>
                <ChevronDown className="w-3 h-3 text-gray-600" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-[200px] bg-white rounded-lg shadow-lg border border-gray-200 p-1 z-50"
                sideOffset={5}
                align="end"
              >
                <DropdownMenu.Item 
                  className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded cursor-pointer outline-none"
                  onSelect={handleMyProfile}
                >
                  <User className="w-4 h-4" />
                  <span>My Profile</span>
                </DropdownMenu.Item>
                
                <DropdownMenu.Item 
                  className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded cursor-pointer outline-none"
                  onSelect={handleMyStars}
                >
                  <Star className="w-4 h-4" />
                  <span>My Stars</span>
                </DropdownMenu.Item>
                
                <DropdownMenu.Item 
                  className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded cursor-pointer outline-none"
                  onSelect={handleMyGists}
                >
                  <FileText className="w-4 h-4" />
                  <span>My Gists</span>
                </DropdownMenu.Item>
                
                <DropdownMenu.Separator className="h-px bg-gray-200 my-1" />
                
                <DropdownMenu.Item 
                  className="flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded cursor-pointer outline-none"
                  onSelect={handleSettings}
                >
                  <Settings className="w-4 h-4" />
                  <span>Settings</span>
                </DropdownMenu.Item>
                
                <DropdownMenu.Separator className="h-px bg-gray-200 my-1" />
                
                <DropdownMenu.Item 
                  className="flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded cursor-pointer outline-none"
                  onSelect={handleSignOut}
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </header>
  );
}
