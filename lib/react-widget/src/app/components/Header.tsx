import { Search, Bell, Menu } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function Header() {
  return (
    <header className="h-14 border-b bg-white flex items-center px-4 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 bg-blue-600 rounded flex items-center justify-center">
          <span className="text-white text-xs font-bold">A</span>
        </div>
        <span className="text-sm">API Community</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          type="text"
          placeholder="搜索"
          className="pl-10 h-9 bg-gray-50 border-0"
        />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3 ml-auto">
        <button className="text-sm text-gray-600 hover:text-gray-900">
          <Bell className="w-5 h-5" />
        </button>
        <span className="text-sm text-orange-500">赠送会员享高速&中转模板</span>
        <Button variant="default" size="sm" className="bg-gray-800 hover:bg-gray-700">
          立即开通
        </Button>
        <Button variant="outline" size="sm">
          对口购买
        </Button>
        <button className="text-gray-600">
          <Menu className="w-5 h-5" />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600" />
      </div>
    </header>
  );
}
