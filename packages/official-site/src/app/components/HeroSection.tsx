import { Button } from '@/app/components/ui/button';
import { Play } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="pt-32 pb-16 bg-white">
      <div className="container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <div className="max-w-xl">
            <h1 className="text-5xl lg:text-6xl font-bold text-gray-900 mb-6">
              Where the world builds APIs
            </h1>
            <p className="text-lg text-gray-600 mb-8">
              The Clover API Platform's features simplify each step of the API lifecycle and streamline collaboration to help you create better APIs faster.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Button className="bg-[#FF6C37] hover:bg-[#FF5722] text-white px-6 py-6 text-base">
                Sign Up for Free
              </Button>
              <div className="flex items-center gap-2 text-gray-600">
                <div className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <span className="text-sm">Watch video</span>
              </div>
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-8 mt-10 pt-8 border-t border-gray-200">
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-gray-900">30M+</span>
                </div>
                <span className="text-sm text-gray-600">Developers</span>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-3xl font-bold text-gray-900">500K+</span>
                </div>
                <span className="text-sm text-gray-600">Organizations</span>
              </div>
            </div>
          </div>

          {/* Right content - Code mockup */}
          <div className="relative">
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 shadow-lg">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                </div>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-blue-600">GET</span>
                  <span className="text-gray-700">https://api.example.com/users</span>
                  <Button size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700">Send</Button>
                </div>
                <div className="mt-6 p-4 bg-white rounded border border-gray-200">
                  <div className="text-xs text-gray-500 mb-2">Response</div>
                  <pre className="text-xs text-gray-700">
{`{
  "users": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com"
    }
  ]
}`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Integration logos */}
        <div className="mt-20">
          <p className="text-center text-sm text-gray-500 mb-8">TRUSTED BY</p>
          <div className="flex flex-wrap justify-center items-center gap-12">
            {['Stripe', 'PayPal', 'Twilio', 'Shopify', 'Salesforce'].map((company) => (
              <div key={company} className="text-gray-400 font-semibold text-xl">
                {company}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
