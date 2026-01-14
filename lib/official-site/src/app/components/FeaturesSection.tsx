import { ArrowRight } from 'lucide-react';
import { Button } from '@/app/components/ui/button';

export function FeaturesSection() {
  return (
    <>
      {/* Dark feature section */}
      <section className="bg-gradient-to-br from-[#2C1810] to-[#1a0f0a] py-20">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="text-white">
              <h2 className="text-4xl font-bold mb-4">
                Design, debug, and test APIs with an all-in-one platform for API development
              </h2>
              <p className="text-gray-300 mb-6 text-lg">
                Assistant's API development environment provides a seamless workflow for designing, debugging, and testing APIs.
              </p>
              <Button className="bg-[#FF6C37] hover:bg-[#FF5722] text-white">
                Learn more <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
            <div className="relative flex justify-center">
              <div className="relative w-64 h-64">
                {/* Circular graphic */}
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#FF6C37] to-[#FF4500] opacity-20 animate-pulse"></div>
                <div className="absolute inset-4 rounded-full bg-gradient-to-br from-[#FF6C37] to-[#FF4500] opacity-40"></div>
                <div className="absolute inset-8 rounded-full bg-gradient-to-br from-[#FF6C37] to-[#FF4500] opacity-60"></div>
                <div className="absolute inset-12 rounded-full bg-gradient-to-br from-[#FF6C37] to-[#FF4500] opacity-80 flex items-center justify-center">
                  <div className="text-white text-center">
                    <div className="text-3xl font-bold">API</div>
                    <div className="text-sm">Testing</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Light feature sections */}
      <section className="bg-white py-20">
        <div className="container mx-auto px-6 space-y-32">
          {/* Feature 1 */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Design APIs your teams control end-to-end
              </h2>
              <p className="text-gray-600 mb-6">
                Use Assistant's powerful tools to design APIs that are consistent, reusable, and easy to understand. Define your API structure and collaborate with your team in real-time.
              </p>
              <a href="#" className="text-[#FF6C37] font-medium inline-flex items-center hover:underline">
                Learn more <ArrowRight className="w-4 h-4 ml-2" />
              </a>
            </div>
            <div className="bg-gray-50 rounded-lg p-8 border border-gray-200">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                    1
                  </div>
                  <div className="flex-1 h-2 bg-gray-200 rounded"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-purple-100 flex items-center justify-center text-purple-600 font-bold">
                    2
                  </div>
                  <div className="flex-1 h-2 bg-gray-200 rounded"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-green-100 flex items-center justify-center text-green-600 font-bold">
                    3
                  </div>
                  <div className="flex-1 h-2 bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="bg-gray-50 rounded-lg p-8 border border-gray-200">
                <div className="space-y-3 font-mono text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">1</span>
                    <span className="text-purple-600">const</span>
                    <span className="text-blue-600">apiKey</span>
                    <span className="text-gray-700">= process.env.API_KEY;</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">2</span>
                    <span className="text-purple-600">const</span>
                    <span className="text-blue-600">response</span>
                    <span className="text-gray-700">= await fetch(url);</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">3</span>
                    <span className="text-purple-600">const</span>
                    <span className="text-blue-600">data</span>
                    <span className="text-gray-700">= await response.json();</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Debug smarter, APIs together
              </h2>
              <p className="text-gray-600 mb-6">
                Leverage automated testing and debugging tools to identify and resolve issues quickly. Share your workspace with team members for collaborative debugging.
              </p>
              <a href="#" className="text-[#FF6C37] font-medium inline-flex items-center hover:underline">
                Learn more <ArrowRight className="w-4 h-4 ml-2" />
              </a>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Test with code/low-code options every environment
              </h2>
              <p className="text-gray-600 mb-6">
                Create comprehensive test suites with flexible testing options. Use our intuitive interface for low-code testing or write custom scripts for advanced scenarios.
              </p>
              <a href="#" className="text-[#FF6C37] font-medium inline-flex items-center hover:underline">
                Learn more <ArrowRight className="w-4 h-4 ml-2" />
              </a>
            </div>
            <div className="bg-gray-50 rounded-lg p-8 border border-gray-200">
              <div className="space-y-3">
                {['Status: 200 OK', 'Response time: 245ms', 'Tests: 8 passed'].map((item, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-white rounded border border-gray-200">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm text-gray-700">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Feature 4 */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="order-2 lg:order-1">
              <div className="bg-gray-50 rounded-lg p-8 border border-gray-200">
                <div className="h-48 flex items-end gap-2">
                  {[40, 65, 45, 80, 60, 90, 70, 85].map((height, index) => (
                    <div key={index} className="flex-1 bg-blue-500 rounded-t" style={{ height: `${height}%` }}></div>
                  ))}
                </div>
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">
                Monitor every API call naturally and confidently
              </h2>
              <p className="text-gray-600 mb-6">
                Track API performance and reliability with comprehensive monitoring. Get instant alerts when issues arise and analyze trends over time.
              </p>
              <a href="#" className="text-[#FF6C37] font-medium inline-flex items-center hover:underline">
                Learn more <ArrowRight className="w-4 h-4 ml-2" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}