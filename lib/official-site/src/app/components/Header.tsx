import { Button } from '@/app/components/ui/button';
import { Menu, Search } from 'lucide-react';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-50">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#FF6C37] flex items-center justify-center">
                <div className="w-5 h-5 rounded-full border-2 border-white"></div>
              </div>
              <span className="font-semibold text-lg">Assistant</span>
            </div>
            
            {/* Navigation */}
            <nav className="hidden lg:flex items-center gap-6">
              <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Products</a>
              <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Solutions</a>
              <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Resources</a>
              <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
              <a href="#" className="text-sm text-gray-600 hover:text-gray-900">Enterprise</a>
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-gray-100 rounded-lg">
              <Search className="w-5 h-5 text-gray-600" />
            </button>
            <div className="hidden md:flex items-center gap-3">
              <Button variant="ghost" className="text-sm">Sign In</Button>
              <Button className="text-sm bg-[#FF6C37] hover:bg-[#FF5722]">Sign Up for Free</Button>
            </div>
            <button className="lg:hidden p-2">
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
